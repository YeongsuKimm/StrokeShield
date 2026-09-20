"""Startup preflight + GET /api/preflight: consistent-config warnings, and never a secret in any output."""
import logging

import pytest
from fastapi.testclient import TestClient

from backend import preflight
from backend.main import app

SECRETS = {
    "SMTP_USER": "sender-secret@example.com",
    "SMTP_APP_PASSWORD": "abcd efgh ijkl mnop",
    "ELEVENLABS_API_KEY": "sk_eleven_secret",
    "ELEVENLABS_AGENT_ID": "agent_secret_id",
    "GEMINI_API_KEY": "gem_secret_key",
    "DEMO_PHONE_NUMBER": "+14105550123",
    "TWILIO_AUTH_TOKEN": "twilio_secret_token",
}
ENV_KEYS = [*SECRETS, "ALERT_CHANNEL", "SMS_GATEWAY_DOMAIN", "TWILIO_ACCOUNT_SID", "TWILIO_FROM_NUMBER"]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in ENV_KEYS:
        monkeypatch.setenv(k, "")


def _good(monkeypatch):
    monkeypatch.setenv("ALERT_CHANNEL", "email_sms")
    monkeypatch.setenv("SMTP_USER", SECRETS["SMTP_USER"])
    monkeypatch.setenv("SMTP_APP_PASSWORD", SECRETS["SMTP_APP_PASSWORD"])
    monkeypatch.setenv("DEMO_PHONE_NUMBER", SECRETS["DEMO_PHONE_NUMBER"])
    monkeypatch.setenv("ELEVENLABS_API_KEY", SECRETS["ELEVENLABS_API_KEY"])
    monkeypatch.setenv("ELEVENLABS_AGENT_ID", SECRETS["ELEVENLABS_AGENT_ID"])
    monkeypatch.setenv("DRY_RUN", "false")


def _has(lines, needle):
    return any(needle in line for line in lines)


def test_consistent_live_config_only_warns_that_dry_run_is_off(monkeypatch):
    _good(monkeypatch)
    lines = preflight.warnings()
    assert lines == ["DRY_RUN is OFF: alerts will really be sent to DEMO_PHONE_NUMBER"]


def test_dry_run_is_flagged(monkeypatch):
    _good(monkeypatch)
    monkeypatch.setenv("DRY_RUN", "true")
    assert _has(preflight.warnings(), "DRY_RUN is on")


def test_email_sms_without_smtp_credentials(monkeypatch):
    _good(monkeypatch)
    monkeypatch.setenv("SMTP_USER", "")
    monkeypatch.setenv("SMTP_APP_PASSWORD", "")
    assert _has(preflight.warnings(), "SMTP_USER / SMTP_APP_PASSWORD are empty")
    assert preflight.snapshot()["smtpConfigured"] is False


@pytest.mark.parametrize("number", ["", "4105550123", "+447911123456"])
def test_bad_or_non_us_demo_number(monkeypatch, number):
    _good(monkeypatch)
    monkeypatch.setenv("DEMO_PHONE_NUMBER", number)
    lines = preflight.warnings()
    if number == "+447911123456":  # valid E.164 but the gateway is US-only
        assert _has(lines, "US (+1)")
        assert not _has(lines, "missing or not valid")
    else:
        assert _has(lines, "missing or not valid E.164")
    assert preflight.snapshot()["gatewayValid"] is False


def test_bad_gateway_domain(monkeypatch):
    _good(monkeypatch)
    monkeypatch.setenv("SMS_GATEWAY_DOMAIN", "not a domain")
    assert _has(preflight.warnings(), "SMS_GATEWAY_DOMAIN")


def test_twilio_channel_needs_twilio_credentials(monkeypatch):
    _good(monkeypatch)
    monkeypatch.setenv("ALERT_CHANNEL", "twilio")
    assert _has(preflight.warnings(), "Twilio credentials are incomplete")


def test_missing_agent_config(monkeypatch):
    _good(monkeypatch)
    monkeypatch.setenv("ELEVENLABS_AGENT_ID", "")
    assert _has(preflight.warnings(), "voice guide is unavailable")
    assert preflight.snapshot()["agentConfigured"] is False


def test_phoneme_on_without_model(monkeypatch):
    _good(monkeypatch)
    monkeypatch.setenv("PHONEME_SCORING", "true")
    monkeypatch.setattr(preflight, "_phoneme_ready", lambda: False)
    assert _has(preflight.warnings(), "PHONEME_SCORING is on")


def test_phoneme_off_is_not_a_warning(monkeypatch):
    _good(monkeypatch)
    assert not _has(preflight.warnings(), "PHONEME")
    assert preflight.snapshot()["phonemeReady"] is False


def test_second_opinion_without_key(monkeypatch):
    _good(monkeypatch)
    monkeypatch.setenv("SECOND_OPINION", "true")
    assert _has(preflight.warnings(), "GEMINI_API_KEY is empty")
    assert preflight.snapshot()["secondOpinionEnabled"] is False
    monkeypatch.setenv("GEMINI_API_KEY", SECRETS["GEMINI_API_KEY"])
    assert preflight.snapshot()["secondOpinionEnabled"] is True


def test_endpoint_returns_only_the_documented_keys_and_no_secrets(monkeypatch):
    _good(monkeypatch)
    monkeypatch.setenv("SECOND_OPINION", "true")
    monkeypatch.setenv("GEMINI_API_KEY", SECRETS["GEMINI_API_KEY"])
    with TestClient(app) as client:
        res = client.get("/api/preflight")
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"alertChannel", "dryRun", "smtpConfigured", "twilioConfigured", "gatewayValid", "agentConfigured", "agentConfiguredEs", "phonemeReady", "secondOpinionEnabled"}
    assert body["alertChannel"] == "email_sms" and body["dryRun"] is False and body["gatewayValid"] is True
    assert all(isinstance(v, (bool, str)) for v in body.values())
    for secret in SECRETS.values():
        assert secret not in res.text
        assert secret.replace(" ", "") not in res.text
    assert "4105550123" not in res.text


def test_startup_logs_warnings_without_secrets(monkeypatch, caplog):
    _good(monkeypatch)
    monkeypatch.setenv("SMTP_APP_PASSWORD", "")
    monkeypatch.setenv("SECOND_OPINION", "true")
    with caplog.at_level(logging.WARNING, logger="strokeshield.startup"):
        with TestClient(app):
            pass
    text = caplog.text
    assert "preflight: ALERT_CHANNEL=email_sms" in text
    for secret in SECRETS.values():
        assert secret not in text


def test_a_crashing_preflight_never_stops_startup(monkeypatch):
    def boom():
        raise RuntimeError("nope")

    monkeypatch.setattr(preflight, "warnings", boom)
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200
