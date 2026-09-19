"""Is the alert ready to send? (Twilio, or email-to-SMS when ALERT_CHANNEL=email_sms.) Diagnoses the whole chain and tells you what to fix. Sends NOTHING unless --send.

    python scripts/sms_check.py            # read-only: checks .env, then asks Twilio (no message sent, no cost)
    python scripts/sms_check.py --send     # after all checks pass, sends ONE real test SMS to DEMO_PHONE_NUMBER

Secrets are never printed (only "set" / lengths / masked numbers). --send goes through the same code path as the app
(services.twilio_service.place_alert), so the demo-number-only guard, rate limit and message format are the real ones.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

E164 = re.compile(r"^\+[1-9]\d{7,14}$")
US_TOLL_FREE = re.compile(r"^\+1(800|833|844|855|866|877|888)\d{7}$")

# Twilio error codes you are likely to meet, with the fix.
TWILIO_HELP = {
    20003: "authentication failed: the Account SID or Auth Token is wrong (copy both again from console.twilio.com).",
    21211: "the destination number is not a valid phone number: use E.164, e.g. +1XXXXXXXXXX.",
    21608: "TRIAL ACCOUNT: the destination is not verified. Verify it in the Twilio console (Phone Numbers > Verified Caller IDs).",
    21606: "the FROM number cannot send SMS: pick a number with SMS capability (or buy/enable one).",
    21610: "the destination replied STOP earlier and is opted out: text START to your Twilio number from that phone.",
    21612: "Twilio can't route SMS between these two countries with this number.",
    21614: "the destination is not a valid mobile number (landlines can't receive SMS).",
    30034: "US carriers block texts from UNREGISTERED US local numbers. Use a verified toll-free number or register for A2P 10DLC (can take days), or see the fallbacks in docs/VALIDATION.md / STATUS.md.",
    30007: "the carrier filtered the message; check the message log in the Twilio console.",
}


@dataclass
class Check:
    name: str
    status: str  # PASS | FAIL | WARN | INFO
    detail: str = ""


def mask(number: str) -> str:
    return f"{number[:2]}{'*' * max(0, len(number) - 6)}{number[-4:]}" if len(number) > 6 else "***"


def check_env(env: Mapping[str, str]) -> list[Check]:
    g = lambda k: (env.get(k) or "").strip()  # noqa: E731
    out: list[Check] = []
    dry = g("DRY_RUN").lower() in {"", "1", "true", "yes", "on"}
    out.append(Check("DRY_RUN", "INFO", "true: the app only LOGS alerts. Set DRY_RUN=false in .env to really send." if dry else "false: the app will really send."))
    to, frm, sid, tok = g("DEMO_PHONE_NUMBER"), g("TWILIO_FROM_NUMBER"), g("TWILIO_ACCOUNT_SID"), g("TWILIO_AUTH_TOKEN")
    out.append(Check("DEMO_PHONE_NUMBER", "PASS" if E164.match(to) else "FAIL", f"{mask(to)}" if E164.match(to) else "missing or not E.164 (+1XXXXXXXXXX)"))
    ok_sid = sid.startswith("AC") and len(sid) == 34
    out.append(Check("TWILIO_ACCOUNT_SID", "PASS" if ok_sid else "FAIL", "looks right" if ok_sid else "missing, or not 'AC' + 32 characters (console.twilio.com > Account Info)"))
    out.append(Check("TWILIO_AUTH_TOKEN", "PASS" if len(tok) == 32 else ("FAIL" if not tok else "WARN"), f"set, {len(tok)} characters" if tok else "missing (console.twilio.com > Account Info > Auth Token > show)"))
    if not frm:
        out.append(Check("TWILIO_FROM_NUMBER", "FAIL", "EMPTY. This is the Twilio phone number the text comes FROM (see below for the numbers on your account)."))
    elif not E164.match(frm):
        out.append(Check("TWILIO_FROM_NUMBER", "FAIL", "not E.164 (+1XXXXXXXXXX)"))
    elif frm == to:
        out.append(Check("TWILIO_FROM_NUMBER", "FAIL", "same as DEMO_PHONE_NUMBER: FROM must be the Twilio number, TO is your own phone"))
    else:
        out.append(Check("TWILIO_FROM_NUMBER", "PASS", mask(frm)))
        if frm.startswith("+1") and not US_TOLL_FREE.match(frm):
            out.append(Check("US local sender", "WARN", "US carriers may block texts from unregistered US local numbers (Twilio error 30034). If a test text never arrives, look at the message log in the Twilio console."))
    return out


def check_twilio(client, env: Mapping[str, str]) -> list[Check]:
    """Read-only calls. `client` is a twilio.rest.Client (or a fake in tests)."""
    from twilio.base.exceptions import (
        TwilioRestException,  # lazy: the script's env checks work without the network
    )

    g = lambda k: (env.get(k) or "").strip()  # noqa: E731
    sid, to, frm = g("TWILIO_ACCOUNT_SID"), g("DEMO_PHONE_NUMBER"), g("TWILIO_FROM_NUMBER")
    out: list[Check] = []
    try:
        acct = client.api.accounts(sid).fetch()
    except TwilioRestException as exc:
        return [Check("Twilio login", "FAIL", TWILIO_HELP.get(exc.code, f"Twilio said: {exc.msg}"))]
    except Exception as exc:  # network down, DNS, etc.
        return [Check("Twilio login", "FAIL", f"could not reach Twilio: {exc}")]
    trial = str(getattr(acct, "type", "")).lower() == "trial"
    out.append(Check("Twilio login", "PASS", f"account status: {getattr(acct, 'status', '?')}, type: {getattr(acct, 'type', '?')}"))
    if trial:
        out.append(Check("Trial account", "INFO", "you can only text VERIFIED numbers, and every text starts with 'Sent from your Twilio trial account -'."))

    try:
        numbers = list(client.incoming_phone_numbers.list(limit=50))
    except Exception as exc:
        numbers = []
        out.append(Check("Twilio numbers", "WARN", f"could not list the numbers on the account: {exc}"))
    sms_numbers = [n for n in numbers if (getattr(n, "capabilities", None) or {}).get("sms")]
    if not numbers:
        out.append(Check("Twilio numbers", "FAIL", "this account has NO phone number. Get one: console.twilio.com > Phone Numbers > Buy a number (trial accounts get one free)."))
    elif not frm:
        listing = ", ".join(n.phone_number for n in sms_numbers) or "(none with SMS)"
        out.append(Check("Twilio numbers", "INFO", f"SMS-capable numbers on your account: {listing}  <- put one in TWILIO_FROM_NUMBER"))
    else:
        mine = next((n for n in numbers if n.phone_number == frm), None)
        if mine is None:
            listing = ", ".join(n.phone_number for n in numbers)
            out.append(Check("FROM number on account", "FAIL", f"{mask(frm)} is not a number on this account. Numbers here: {listing}"))
        elif not (getattr(mine, "capabilities", None) or {}).get("sms"):
            out.append(Check("FROM number on account", "FAIL", "that number cannot send SMS (no SMS capability). Pick another or enable messaging."))
        else:
            out.append(Check("FROM number on account", "PASS", "exists and can send SMS"))

    if trial and E164.match(to):
        try:
            verified = list(client.outgoing_caller_ids.list(phone_number=to, limit=1))
        except Exception as exc:
            verified = None
            out.append(Check("Destination verified", "WARN", f"could not check: {exc}"))
        if verified is not None:
            out.append(
                Check("Destination verified", "PASS", "your phone is a verified caller ID")
                if verified
                else Check("Destination verified", "FAIL", f"{mask(to)} is NOT verified. Trial accounts can only text verified numbers: console.twilio.com > Phone Numbers > Manage > Verified Caller IDs > Add.")
            )
    return out


def send_test(env: Mapping[str, str]) -> Check:
    """One REAL SMS through the app's own alert path (demo-number guard, rate limit, message format)."""
    os.environ["DRY_RUN"] = "false"
    from backend.schemas import AlertRequest
    from services.twilio_service import place_alert

    req = AlertRequest(reason="user_request", patient={"name": "TEST"}, symptoms=["this is a test message from sms_check.py"], last_known_well="now")
    res = place_alert(req)
    if res.ok:
        if not res.sms_sid:  # email-to-SMS has no message id
            return Check("Test SMS", "PASS", "handed to the mail server. The text should reach the phone within a minute; check spam-blocking on the carrier side if not.")
        return Check("Test SMS", "PASS", f"queued (sid {res.sms_sid}). It should arrive in a few seconds; if not, open the message log in the Twilio console for the error code.")
    code = re.search(r"\b(\d{5})\b", res.error or "")
    hint = TWILIO_HELP.get(int(code.group(1))) if code else None
    return Check("Test SMS", "FAIL", f"{res.error}" + (f"\n      -> {hint}" if hint else ""))


GMAIL_HELP = {
    534: "Google wants an APP PASSWORD, not your normal password (turn on 2-Step Verification, then myaccount.google.com/apppasswords).",
    535: "Gmail rejected the login: the address or app password is wrong. Create a fresh app password and paste it as SMTP_APP_PASSWORD.",
}


def check_email_env(env: Mapping[str, str]) -> list[Check]:
    """Email-to-SMS settings (ALERT_CHANNEL=email_sms). Secrets are never printed."""
    g = lambda k: (env.get(k) or "").strip()  # noqa: E731
    out: list[Check] = []
    dry = g("DRY_RUN").lower() in {"", "1", "true", "yes", "on"}
    out.append(Check("DRY_RUN", "INFO", "true: the app only LOGS alerts. Set DRY_RUN=false in .env to really send." if dry else "false: the app will really send."))
    to = g("DEMO_PHONE_NUMBER")
    domain = (g("SMS_GATEWAY_DOMAIN") or "vtext.com").lower()
    if re.match(r"^\+1\d{10}$", to) and re.match(r"^[a-z0-9.-]+\.[a-z]{2,}$", domain):
        out.append(Check("Gateway address", "PASS", f"the alert will go to ***{to[-4:]}@{domain} (built from DEMO_PHONE_NUMBER)"))
    else:
        out.append(Check("Gateway address", "FAIL", "needs a US DEMO_PHONE_NUMBER (+1XXXXXXXXXX) and a valid SMS_GATEWAY_DOMAIN (Verizon: vtext.com)"))
    user, pw = g("SMTP_USER"), g("SMTP_APP_PASSWORD").replace(" ", "")
    out.append(Check("SMTP_USER", "PASS" if re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", user) else "FAIL", "set" if user else "missing: the Gmail address the text is sent from"))
    if not pw:
        out.append(Check("SMTP_APP_PASSWORD", "FAIL", "missing: create one at myaccount.google.com/apppasswords (needs 2-Step Verification)"))
    else:
        out.append(Check("SMTP_APP_PASSWORD", "PASS" if len(pw) == 16 else "WARN", f"set, {len(pw)} characters (Google app passwords are 16)"))
    if domain == "vtext.com":
        out.append(Check("Carrier", "INFO", "Verizon's vtext.com gateway is scheduled to shut down 2027-03-31; delivery is best-effort and has no receipt."))
    return out


def check_smtp_login(env: Mapping[str, str], smtp_factory=None) -> list[Check]:
    """Read-only: connect, STARTTLS, log in, quit. Sends no mail."""
    import smtplib

    g = lambda k: (env.get(k) or "").strip()  # noqa: E731
    host, port = g("SMTP_HOST") or "smtp.gmail.com", int(g("SMTP_PORT") or 587)
    factory = smtp_factory or smtplib.SMTP
    try:
        with factory(host, port, timeout=10) as smtp:
            smtp.starttls()
            smtp.login(g("SMTP_USER"), g("SMTP_APP_PASSWORD").replace(" ", ""))
    except smtplib.SMTPAuthenticationError as exc:
        return [Check("SMTP login", "FAIL", GMAIL_HELP.get(exc.smtp_code, f"the mail server refused the login (code {exc.smtp_code})"))]
    except Exception as exc:  # network down, DNS, blocked port 587
        return [Check("SMTP login", "FAIL", f"could not reach {host}:{port} ({type(exc).__name__}). Is port 587 blocked on this network?")]
    return [Check("SMTP login", "PASS", f"logged in to {host} as the sender (no mail was sent)")]


def main_email(args, env: Mapping[str, str], out: Callable[[str], None], smtp_factory=None) -> int:
    out("Email-to-SMS readiness check (nothing is sent unless you pass --send)\n")
    checks = check_email_env(env)
    render(checks, out)
    if all(c.status != "FAIL" for c in checks):
        more = check_smtp_login(env, smtp_factory)
        out("\nAsking the mail server (read-only, no mail sent):")
        render(more, out)
        checks += more
    failed = [c for c in checks if c.status == "FAIL"]
    out("")
    if failed:
        out(f"NOT READY: fix the {len(failed)} FAIL item(s) above, then run this again.")
        return 1
    out("READY: every check passed.")
    if args.send:
        out("\nSending ONE real test text through the app's alert path...")
        res = send_test(env)
        render([res], out)
        return 0 if res.status == "PASS" else 1
    out("Next: set DRY_RUN=false in .env only when you want real sends, and run:  python scripts/sms_check.py --send")
    return 0


def render(checks: list[Check], out: Callable[[str], None]) -> None:
    for c in checks:
        out(f"  [{c.status:4}] {c.name}: {c.detail}")


def main(argv: list[str] | None = None, client_factory=None, env: Mapping[str, str] | None = None, out: Callable[[str], None] = print, smtp_factory=None) -> int:
    ap = argparse.ArgumentParser(description="Check (and optionally test) the Twilio SMS alert setup. Sends nothing without --send.")
    ap.add_argument("--send", action="store_true", help="after all checks pass, send ONE real test SMS to DEMO_PHONE_NUMBER")
    args = ap.parse_args(argv)
    if env is None:
        from backend import settings  # noqa: F401  (loads .env)

        env = os.environ
    if (env.get("ALERT_CHANNEL") or "").strip().lower() == "email_sms":
        return main_email(args, env, out, smtp_factory)
    out("SMS readiness check (nothing is sent unless you pass --send)\n")
    checks = check_env(env)
    render(checks, out)
    # Ask Twilio (read-only) whenever the login details look right, even if FROM is still empty: that is exactly when
    # it is useful to see which numbers the account has.
    creds_ok = all(c.status != "FAIL" for c in checks if c.name in {"TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"})
    if creds_ok:
        if client_factory is None:
            from twilio.rest import Client

            client_factory = lambda e: Client(e["TWILIO_ACCOUNT_SID"].strip(), e["TWILIO_AUTH_TOKEN"].strip())  # noqa: E731
        more = check_twilio(client_factory(env), env)
        out("\nAsking Twilio (read-only):")
        render(more, out)
        checks += more
    failed = [c for c in checks if c.status == "FAIL"]
    out("")
    if failed:
        out(f"NOT READY: fix the {len(failed)} FAIL item(s) above, then run this again.")
        return 1
    out("READY: every check passed.")
    if args.send:
        out("\nSending ONE real test SMS through the app's alert path...")
        res = send_test(env)
        render([res], out)
        return 0 if res.status == "PASS" else 1
    out("Next: set DRY_RUN=false in .env only when you want real sends, and run:  python scripts/sms_check.py --send")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
