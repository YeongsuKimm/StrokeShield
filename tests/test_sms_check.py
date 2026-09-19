"""scripts/sms_check.py: env validation, read-only Twilio checks (fake client), and that it never sends without --send."""
import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

_spec = importlib.util.spec_from_file_location("sms_check", Path(__file__).resolve().parents[1] / "scripts" / "sms_check.py")
sms = importlib.util.module_from_spec(_spec)
sys.modules["sms_check"] = sms
_spec.loader.exec_module(sms)

GOOD = {
    "DRY_RUN": "true",
    "DEMO_PHONE_NUMBER": "+15555550100",
    "TWILIO_ACCOUNT_SID": "AC" + "a" * 32,
    "TWILIO_AUTH_TOKEN": "b" * 32,
    "TWILIO_FROM_NUMBER": "+18445550123",  # toll-free: no US-local warning
}


def status(checks, name):
    return next(c.status for c in checks if c.name == name)


def test_good_env_passes_and_secrets_are_never_printed():
    checks = sms.check_env(GOOD)
    assert not [c for c in checks if c.status == "FAIL"]
    text = " ".join(c.detail for c in checks)
    assert GOOD["TWILIO_AUTH_TOKEN"] not in text and GOOD["TWILIO_ACCOUNT_SID"] not in text
    assert "+15555550100" not in text  # numbers are masked


@pytest.mark.parametrize(
    "override,name",
    [
        ({"TWILIO_FROM_NUMBER": ""}, "TWILIO_FROM_NUMBER"),
        ({"TWILIO_FROM_NUMBER": "8445550123"}, "TWILIO_FROM_NUMBER"),
        ({"TWILIO_FROM_NUMBER": "+15555550100"}, "TWILIO_FROM_NUMBER"),  # same as destination
        ({"DEMO_PHONE_NUMBER": "555"}, "DEMO_PHONE_NUMBER"),
        ({"TWILIO_ACCOUNT_SID": "xyz"}, "TWILIO_ACCOUNT_SID"),
        ({"TWILIO_AUTH_TOKEN": ""}, "TWILIO_AUTH_TOKEN"),
    ],
)
def test_bad_env_values_fail(override, name):
    assert status(sms.check_env({**GOOD, **override}), name) == "FAIL"


def test_us_local_sender_gets_a_warning():
    checks = sms.check_env({**GOOD, "TWILIO_FROM_NUMBER": "+14105550123"})
    assert status(checks, "US local sender") == "WARN"


class FakeClient:
    def __init__(self, numbers=(), verified=(), acct_type="Trial", raise_auth=False):
        self._numbers, self._verified = list(numbers), list(verified)
        self.acct_type, self.raise_auth = acct_type, raise_auth
        self.sent = []
        me = self
        self.api = SimpleNamespace(accounts=lambda sid: SimpleNamespace(fetch=me._fetch))
        self.incoming_phone_numbers = SimpleNamespace(list=lambda limit=50: me._numbers)
        self.outgoing_caller_ids = SimpleNamespace(list=lambda phone_number=None, limit=1: me._verified)
        self.messages = SimpleNamespace(create=lambda **kw: me.sent.append(kw))

    def _fetch(self):
        if self.raise_auth:
            from twilio.base.exceptions import TwilioRestException

            raise TwilioRestException(401, "uri", msg="Authenticate", code=20003)
        return SimpleNamespace(status="active", type=self.acct_type)


def num(n, sms_cap=True):
    return SimpleNamespace(phone_number=n, capabilities={"sms": sms_cap, "voice": True})


def test_lists_account_numbers_when_from_is_empty():
    c = FakeClient(numbers=[num("+18445550123")], verified=[object()])
    checks = sms.check_twilio(c, {**GOOD, "TWILIO_FROM_NUMBER": ""})
    listing = next(x for x in checks if x.name == "Twilio numbers")
    assert "+18445550123" in listing.detail and "TWILIO_FROM_NUMBER" in listing.detail


def test_trial_destination_must_be_verified():
    c = FakeClient(numbers=[num("+18445550123")], verified=[])
    checks = sms.check_twilio(c, GOOD)
    assert status(checks, "Destination verified") == "FAIL"
    c2 = FakeClient(numbers=[num("+18445550123")], verified=[object()])
    assert status(sms.check_twilio(c2, GOOD), "Destination verified") == "PASS"


def test_from_number_must_exist_and_have_sms():
    assert status(sms.check_twilio(FakeClient(numbers=[num("+19995550000")], verified=[object()]), GOOD), "FROM number on account") == "FAIL"
    assert status(sms.check_twilio(FakeClient(numbers=[num("+18445550123", sms_cap=False)], verified=[object()]), GOOD), "FROM number on account") == "FAIL"
    assert status(sms.check_twilio(FakeClient(numbers=[num("+18445550123")], verified=[object()]), GOOD), "FROM number on account") == "PASS"


def test_account_without_numbers_and_bad_login_are_explained():
    assert status(sms.check_twilio(FakeClient(numbers=[], verified=[object()]), GOOD), "Twilio numbers") == "FAIL"
    checks = sms.check_twilio(FakeClient(raise_auth=True), GOOD)
    assert status(checks, "Twilio login") == "FAIL" and "Auth Token" in checks[0].detail


def test_main_reports_not_ready_and_never_sends_without_flag(monkeypatch):
    lines: list[str] = []
    client = FakeClient(numbers=[num("+18445550123")], verified=[])
    code = sms.main([], client_factory=lambda e: client, env={**GOOD, "TWILIO_FROM_NUMBER": ""}, out=lines.append)
    assert code == 1 and any("NOT READY" in ln for ln in lines) and client.sent == []


def test_main_ready_without_send_flag_sends_nothing():
    lines: list[str] = []
    client = FakeClient(numbers=[num("+18445550123")], verified=[object()])
    assert sms.main([], client_factory=lambda e: client, env=GOOD, out=lines.append) == 0
    assert any("READY" in ln for ln in lines) and client.sent == []


def test_send_flag_goes_through_the_real_alert_path_to_the_env_number_only(monkeypatch):
    monkeypatch.setenv("DEMO_PHONE_NUMBER", GOOD["DEMO_PHONE_NUMBER"])
    for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"):
        monkeypatch.setenv(k, GOOD[k])
    from services import twilio_service

    monkeypatch.setattr(twilio_service, "_last_alert_at", None)
    sent = []

    class Fake:
        def __init__(self, *a):
            self.messages = SimpleNamespace(create=lambda **kw: (sent.append(kw), SimpleNamespace(sid="SM123"))[1])

    monkeypatch.setattr("twilio.rest.Client", Fake)
    lines: list[str] = []
    client = FakeClient(numbers=[num("+18445550123")], verified=[object()])
    assert sms.main(["--send"], client_factory=lambda e: client, env=GOOD, out=lines.append) == 0
    assert [kw["to"] for kw in sent] == [GOOD["DEMO_PHONE_NUMBER"]]
    assert any("SM123" in ln for ln in lines)


# --- email-to-SMS mode (ALERT_CHANNEL=email_sms) ---
EMAIL = {
    "ALERT_CHANNEL": "email_sms",
    "DRY_RUN": "true",
    "DEMO_PHONE_NUMBER": "+19379419482",
    "SMS_GATEWAY_DOMAIN": "vtext.com",
    "SMTP_USER": "demo.sender@gmail.com",
    "SMTP_APP_PASSWORD": "abcd efgh ijkl mnop",
}


class _Smtp:
    login_error = None

    def __init__(self, host, port, timeout=None):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def starttls(self):
        pass

    def login(self, user, password):
        if _Smtp.login_error:
            raise _Smtp.login_error

    def send_message(self, *a, **k):  # the read-only check must never send
        raise AssertionError("the readiness check must not send mail")


def test_email_env_passes_and_never_prints_secrets_or_the_full_number():
    checks = sms.check_email_env(EMAIL)
    assert not [c for c in checks if c.status == "FAIL"]
    text = " ".join(c.detail for c in checks)
    assert "abcd" not in text and "demo.sender" not in text and "9379419482" not in text


@pytest.mark.parametrize(
    "override,name",
    [
        ({"SMTP_USER": ""}, "SMTP_USER"),
        ({"SMTP_USER": "not-an-email"}, "SMTP_USER"),
        ({"SMTP_APP_PASSWORD": ""}, "SMTP_APP_PASSWORD"),
        ({"DEMO_PHONE_NUMBER": "+447911123456"}, "Gateway address"),
        ({"SMS_GATEWAY_DOMAIN": "nodot"}, "Gateway address"),
    ],
)
def test_email_env_failures_are_reported(override, name):
    assert status(sms.check_email_env({**EMAIL, **override}), name) == "FAIL"


def test_smtp_login_check_passes_and_sends_nothing():
    _Smtp.login_error = None
    assert sms.check_smtp_login(EMAIL, _Smtp)[0].status == "PASS"


def test_smtp_login_rejection_gives_the_app_password_hint():
    import smtplib

    _Smtp.login_error = smtplib.SMTPAuthenticationError(535, b"bad")
    (c,) = sms.check_smtp_login(EMAIL, _Smtp)
    _Smtp.login_error = None
    assert c.status == "FAIL" and "app password" in c.detail.lower()


def test_main_dispatches_to_email_mode_and_does_not_send_without_the_flag():
    lines: list[str] = []
    _Smtp.login_error = None
    assert sms.main([], env=EMAIL, out=lines.append, smtp_factory=_Smtp) == 0  # fake SMTP: no network, no mail
    assert any("Email-to-SMS readiness" in ln for ln in lines) and any("READY" in ln for ln in lines)
    assert not any("Sending ONE real" in ln for ln in lines)
