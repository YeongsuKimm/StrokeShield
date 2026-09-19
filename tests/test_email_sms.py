"""Email-to-SMS alerts: fully offline (smtplib is replaced by a fake), so no mail is ever sent from a test."""
import smtplib

import pytest

from backend import settings
from backend.schemas import AlertRequest
from services import email_sms_service, twilio_service
from services.twilio_service import place_alert

PHONE = "+19379419482"
GATEWAY = "9379419482@vtext.com"


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("ALERT_CHANNEL", "email_sms")
    monkeypatch.setenv("DEMO_PHONE_NUMBER", PHONE)
    monkeypatch.setenv("SMS_GATEWAY_DOMAIN", "vtext.com")
    monkeypatch.setenv("SMTP_USER", "demo.sender@gmail.com")
    monkeypatch.setenv("SMTP_APP_PASSWORD", "abcd efgh ijkl mnop")
    monkeypatch.setenv("DRY_RUN", "false")
    monkeypatch.setattr(twilio_service, "_last_alert_at", None)


class FakeSMTP:
    instances: list["FakeSMTP"] = []
    fail_login: Exception | None = None

    def __init__(self, host, port, timeout=None):
        self.host, self.port, self.timeout = host, port, timeout
        self.calls: list[str] = []
        self.sent = None
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def starttls(self):
        self.calls.append("starttls")

    def login(self, user, password):
        if FakeSMTP.fail_login:
            raise FakeSMTP.fail_login
        self.calls.append("login")
        self.creds = (user, password)

    def send_message(self, msg, from_addr=None, to_addrs=None):
        self.calls.append("send")
        self.sent = (msg, from_addr, to_addrs)


@pytest.fixture
def smtp(monkeypatch):
    FakeSMTP.instances = []
    FakeSMTP.fail_login = None
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    return FakeSMTP


def req(**kw):
    return AlertRequest(reason="user_request", **kw)


# --- the gateway address (the ONLY place a recipient comes from) ---
def test_gateway_address_is_derived_from_the_env_number_only():
    assert settings.sms_gateway_address() == GATEWAY


@pytest.mark.parametrize("number", ["", "+447911123456", "+1937941", "9379419482", "+1937941948299"])
def test_no_gateway_address_for_a_non_us_or_malformed_number(monkeypatch, number):
    monkeypatch.setenv("DEMO_PHONE_NUMBER", number)
    assert settings.sms_gateway_address() is None


@pytest.mark.parametrize("domain", ["evil.com/../x", "a b.com", "vtext.com,x@y.com", "nodot", "vtext.com\r\nBcc: x@y.com"])
def test_malformed_gateway_domains_are_refused(monkeypatch, domain):
    monkeypatch.setenv("SMS_GATEWAY_DOMAIN", domain)
    assert settings.sms_gateway_address() is None


def test_the_domain_is_configurable_for_other_carriers(monkeypatch):
    monkeypatch.setenv("SMS_GATEWAY_DOMAIN", "email.uscc.net")
    assert settings.sms_gateway_address() == "9379419482@email.uscc.net"


# --- the message ---
def test_message_fits_one_sms_even_with_huge_inputs_and_has_no_newlines():
    long = "x" * 150 + "\r\nBcc: attacker@example.com"  # the schema already caps last_known_well at 200 characters
    body = email_sms_service.build_short_message(
        req(symptoms=[long, long], last_known_well=long, location={"lat": 39.758948, "lng": -84.191605, "accuracyM": 12}),
    )
    assert len(body) <= email_sms_service.MAX_SMS_CHARS
    assert "\n" not in body and "\r" not in body
    assert body.startswith("StrokeShield ALERT")


def test_message_rounds_the_location_and_says_when_it_is_missing():
    with_loc = email_sms_service.build_short_message(req(location={"lat": 39.758948, "lng": -84.191605}))
    assert "maps.google.com/?q=39.7589,-84.1916" in with_loc and "39.758948" not in with_loc
    assert "Location unavailable" in email_sms_service.build_short_message(req())


def test_message_never_contains_the_patient_name():
    assert "Alice Example" not in email_sms_service.build_short_message(req(patient={"name": "Alice Example"}))


# --- sending ---
def test_a_live_alert_mails_only_the_gateway_over_starttls_with_the_env_login(smtp):
    res = place_alert(req(last_known_well="9:00"))
    assert res.ok and not res.dry_run
    (s,) = smtp.instances
    assert (s.host, s.port, s.timeout) == ("smtp.gmail.com", 587, 10)
    assert s.calls == ["starttls", "login", "send"]
    assert s.creds == ("demo.sender@gmail.com", "abcdefghijklmnop")  # the app password's spaces are removed
    msg, from_addr, to_addrs = s.sent
    assert to_addrs == [GATEWAY] and from_addr == "demo.sender@gmail.com"
    assert msg["To"] == GATEWAY and msg["Subject"] == ""
    assert msg["Bcc"] is None and msg["Cc"] is None


def test_client_text_can_only_reach_the_body_never_a_header(smtp):
    place_alert(req(last_known_well="ok\r\nBcc: attacker@example.com\r\nSubject: hi", symptoms=["a\r\nTo: x@y.com"]))
    msg = smtp.instances[0].sent[0]
    assert msg["Bcc"] is None and msg["To"] == GATEWAY
    assert "\r" not in msg.get_content().rstrip("\n") and "\n" not in msg.get_content().rstrip("\n")


def test_dry_run_sends_nothing(smtp, monkeypatch):
    monkeypatch.setenv("DRY_RUN", "true")
    res = place_alert(req())
    assert res.ok and res.dry_run and smtp.instances == []


def test_a_typo_in_dry_run_still_means_dry_run(smtp, monkeypatch):
    monkeypatch.setenv("DRY_RUN", "flase")
    assert place_alert(req()).dry_run and smtp.instances == []


def test_one_alert_per_two_minutes(smtp):
    assert place_alert(req()).ok
    second = place_alert(req())
    assert not second.ok and "rate limited" in second.error and len(smtp.instances) == 1


def test_missing_smtp_config_is_a_clear_error_not_a_crash(smtp, monkeypatch):
    monkeypatch.setenv("SMTP_APP_PASSWORD", "")
    res = place_alert(req())
    assert not res.ok and "not configured" in res.error and smtp.instances == []


def test_a_non_us_number_is_refused_before_anything_is_sent(smtp, monkeypatch):
    monkeypatch.setenv("DEMO_PHONE_NUMBER", "+447911123456")
    res = place_alert(req())
    assert not res.ok and smtp.instances == []


def test_risk_alerts_still_need_a_server_side_risk_confirmation(smtp):
    res = place_alert(AlertRequest(reason="risk_threshold"))
    assert not res.ok and "threshold" in res.error and smtp.instances == []


def test_a_login_failure_is_reported_helpfully_without_leaking_secrets(smtp):
    smtp.fail_login = smtplib.SMTPAuthenticationError(535, b"5.7.8 Username and Password not accepted for demo.sender@gmail.com")
    res = place_alert(req())
    assert not res.ok and "email login failed" in res.error
    assert "demo.sender" not in res.error and "abcd" not in res.error and "535" not in res.error
    assert twilio_service._last_alert_at is None  # a failed send must not start the rate-limit window


def test_any_other_smtp_failure_is_generic(smtp):
    smtp.fail_login = TimeoutError("connect to smtp.gmail.com timed out for demo.sender@gmail.com")
    res = place_alert(req())
    assert not res.ok and res.error == "Alert could not be sent"
    assert twilio_service._last_alert_at is None


def test_the_endpoint_uses_the_channel_and_a_body_cannot_add_a_recipient(smtp):
    from fastapi.testclient import TestClient

    from backend.main import app

    client = TestClient(app)
    bad = client.post("/api/alert", json={"reason": "user_request", "to": "attacker@example.com", "email": "a@b.com"})
    assert bad.status_code == 422 and smtp.instances == []
    ok = client.post("/api/alert", json={"reason": "user_request"})
    assert ok.status_code == 200 and ok.json()["ok"] is True
    assert smtp.instances[0].sent[2] == [GATEWAY]


def test_twilio_is_unchanged_when_the_channel_is_twilio(monkeypatch, smtp):
    monkeypatch.setenv("ALERT_CHANNEL", "twilio")
    monkeypatch.setenv("DRY_RUN", "true")
    assert place_alert(req()).dry_run and smtp.instances == []
