"""Email-to-SMS alerts: mail the carrier's text gateway (<10 digits>@vtext.com for Verizon) over SMTP (Gmail app password).

SAFETY (AGENTS.md rule 1): the ONLY recipient is `settings.sms_gateway_address()`, derived from DEMO_PHONE_NUMBER in the
environment. Nothing from a request can reach the To/From/Subject headers; client text only ever lands in the body, with
control characters flattened so it cannot add headers or extra lines. Credentials come from SMTP_USER / SMTP_APP_PASSWORD
and are never logged or returned.
"""
import logging
import os
import re
import smtplib
from email.message import EmailMessage

from backend.schemas import AlertRequest

log = logging.getLogger("alert")

MAX_SMS_CHARS = 160  # one segment; longer texts get split or dropped by some carriers
_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")


def _flat(text: str, limit: int) -> str:
    text = _CONTROL.sub(" ", text).strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def build_short_message(req: AlertRequest) -> str:
    """One SMS segment, most important parts first; optional parts are dropped when they do not fit."""
    parts = ["StrokeShield ALERT: possible stroke signs."]
    optional = [f"Last well: {_flat(req.last_known_well, 40) if req.last_known_well else 'unknown'}."]
    if req.location:  # rounded to 4 decimals (about 11 m): enough to find someone, no more precise than needed
        optional.append(f"Map: maps.google.com/?q={req.location.lat:.4f},{req.location.lng:.4f}")
    else:
        optional.append("Location unavailable.")
    if req.symptoms:
        optional.append(f"Flags: {_flat('; '.join(req.symptoms), 40)}.")
    if req.risk:
        optional.append(f"Risk {req.risk.risk:.0%}.")
    optional.append("Demo message.")
    for part in optional:
        if len(" ".join([*parts, part])) <= MAX_SMS_CHARS:
            parts.append(part)
    return _flat(" ".join(parts), MAX_SMS_CHARS)


def smtp_config() -> tuple[str, int, str, str] | None:
    user = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_APP_PASSWORD", "").replace(" ", "").strip()  # Google shows it in 4 groups of 4
    if not (user and password):
        return None
    try:
        port = int(os.getenv("SMTP_PORT", "587"))
    except ValueError:
        port = 587
    return os.getenv("SMTP_HOST", "smtp.gmail.com").strip() or "smtp.gmail.com", port, user, password


def send(to_addr: str, body: str) -> None:
    """Blocking. Raises on any failure (the caller turns it into a generic error). Caller already checked the config."""
    config = smtp_config()
    if config is None:
        raise RuntimeError("SMTP is not configured")
    host, port, user, password = config
    msg = EmailMessage()
    msg["From"] = user
    msg["To"] = to_addr
    msg["Subject"] = ""  # many gateways prepend the subject to the text; the body carries everything
    msg.set_content(_flat(body, MAX_SMS_CHARS))
    with smtplib.SMTP(host, port, timeout=10) as smtp:
        smtp.starttls()
        smtp.login(user, password)
        smtp.send_message(msg, from_addr=user, to_addrs=[to_addr])
