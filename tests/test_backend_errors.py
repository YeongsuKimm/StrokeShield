"""Error-path and safety tests for the alert, signed-URL and settings code: graceful failures, no secrets/PII leaked."""
import httpx
import pytest
from fastapi.testclient import TestClient

from backend import settings
from backend.main import app
from services import elevenlabs_service, twilio_service

client = TestClient(app, raise_server_exceptions=False)
BODY = {"reason": "user_request", "patient": {"name": "Sam Private"}, "symptoms": ["arm drifts"]}


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("DEMO_PHONE_NUMBER", "+15555550100")
    monkeypatch.setenv("DRY_RUN", "true")
    monkeypatch.setattr(twilio_service, "_last_alert_at", None)


def arm_live(monkeypatch, client_cls):
    monkeypatch.setenv("DRY_RUN", "false")
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "ACsecretsid")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "secrettoken")
    monkeypatch.setenv("TWILIO_FROM_NUMBER", "+15555550199")
    monkeypatch.setattr("twilio.rest.Client", client_cls)


# ---- DRY_RUN fails safe ----------------------------------------------------------------------------------------------

@pytest.mark.parametrize("value", ["", "flase", "tru", "maybe", " TRUE "])
def test_garbage_dry_run_values_stay_dry(monkeypatch, value):
    monkeypatch.setenv("DRY_RUN", value)
    assert settings.dry_run() is True


@pytest.mark.parametrize("value", ["false", "FALSE", " 0 ", "no", "off"])
def test_only_explicit_false_arms_real_sending(monkeypatch, value):
    monkeypatch.setenv("DRY_RUN", value)
    assert settings.dry_run() is False


def test_dry_run_defaults_true_when_unset(monkeypatch):
    monkeypatch.delenv("DRY_RUN")
    monkeypatch.setattr("backend.settings.load_dotenv", lambda *a, **k: None)
    assert settings.dry_run() is True


def test_malformed_risk_threshold_falls_back(monkeypatch):
    monkeypatch.setenv("RISK_THRESHOLD", "not-a-number")
    assert settings.risk_threshold() == 0.5
    assert client.post("/api/alert", json=BODY).status_code == 200


def test_invalid_demo_number_is_refused_not_used(monkeypatch):
    for bad in ("911", "+1", "555-0100", "+0123456789", "tel:+15555550100"):
        monkeypatch.setenv("DEMO_PHONE_NUMBER", bad)
        res = client.post("/api/alert", json=BODY)
        assert res.status_code == 200 and res.json()["ok"] is False


# ---- Twilio failure is graceful and leak-free -------------------------------------------------------------------------

def test_twilio_failure_returns_ok_false_without_leaking(monkeypatch):
    class TwilioBoom(Exception):
        code = 21608

    class Failing:
        def __init__(self, *a):
            def create(**kw):
                raise TwilioBoom("Unable to create record for +15555550100 on account ACsecretsid")

            self.messages = type("M", (), {"create": staticmethod(create)})()

    arm_live(monkeypatch, Failing)
    res = client.post("/api/alert", json=BODY)
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is False and body["dryRun"] is False
    assert "21608" in body["error"]
    text = res.text
    for secret in ("ACsecretsid", "secrettoken", "+15555550100", "+15555550199", "Sam Private"):
        assert secret not in text
    # a failed send must not start the rate-limit window: the user can retry immediately
    assert twilio_service._last_alert_at is None


def test_twilio_client_construction_failure_is_graceful(monkeypatch):
    def broken(*a):
        raise RuntimeError("bad credentials ACsecretsid")

    arm_live(monkeypatch, broken)
    res = client.post("/api/alert", json=BODY)
    assert res.status_code == 200 and res.json()["ok"] is False and "ACsecretsid" not in res.text


def test_missing_twilio_credentials_is_graceful(monkeypatch):
    monkeypatch.setenv("DRY_RUN", "false")
    for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr("backend.settings.load_dotenv", lambda *a, **k: None)
    res = client.post("/api/alert", json=BODY)
    assert res.status_code == 200 and res.json()["ok"] is False and "not configured" in res.json()["error"]


# ---- Bad input --------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("bad", [
    {},
    {"reason": "nope"},
    {**BODY, "location": {"lat": 999, "lng": 0}},
    {**BODY, "lastKnownWell": "x" * 201},
    {**BODY, "symptoms": ["s"] * 21},
    {**BODY, "to": "+15555550123"},
    {**BODY, "destination": "+15555550123"},
])
def test_bad_alert_bodies_are_422(bad):
    assert client.post("/api/alert", json=bad).status_code == 422


def test_non_json_alert_body_is_422():
    assert client.post("/api/alert", content=b"not json", headers={"content-type": "application/json"}).status_code == 422


def test_sms_body_clips_long_free_text():
    from backend.schemas import AlertRequest

    req = AlertRequest.model_validate({**BODY, "symptoms": ["y" * 5000], "patient": {"name": "n" * 5000}})
    assert len(twilio_service.build_message(req)) < 600


def test_live_send_never_uses_a_body_supplied_number(monkeypatch):
    sent = []

    class Spy:
        def __init__(self, *a):
            self.messages = type("M", (), {"create": lambda _s, **kw: (sent.append(kw), type("O", (), {"sid": "SM9"})())[1]})()

    arm_live(monkeypatch, Spy)
    assert client.post("/api/alert", json={**BODY, "to": "+911"}).status_code == 422
    assert sent == []
    assert client.post("/api/alert", json=BODY).json()["smsSid"] == "SM9"
    assert [kw["to"] for kw in sent] == ["+15555550100"]


def test_dry_run_log_has_no_pii(monkeypatch, caplog):
    with caplog.at_level("INFO"):
        client.post("/api/alert", json=BODY)
    assert "Sam Private" not in " ".join(r.getMessage() for r in caplog.records)


# ---- Signed URL ---------------------------------------------------------------------------------------------------------

def test_signed_url_unconfigured_is_503_without_key_material(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.delenv("ELEVENLABS_AGENT_ID", raising=False)
    monkeypatch.setattr("backend.settings.load_dotenv", lambda *a, **k: None)
    res = client.get("/api/agent/signed-url")
    assert res.status_code == 503 and "xi-api-key" not in res.text


def _mock_elevenlabs(monkeypatch, handler):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "sk-secretkey")
    monkeypatch.setenv("ELEVENLABS_AGENT_ID", "agent_123")
    real = httpx.AsyncClient
    monkeypatch.setattr(elevenlabs_service.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))


def test_signed_url_success(monkeypatch):
    _mock_elevenlabs(monkeypatch, lambda req: httpx.Response(200, json={"signed_url": "wss://x/y"}))
    res = client.get("/api/agent/signed-url")
    assert res.status_code == 200 and res.json() == {"signedUrl": "wss://x/y"}


@pytest.mark.parametrize("response", [
    httpx.Response(401, text="bad key sk-secretkey"),
    httpx.Response(200, text="<html>not json sk-secretkey</html>"),
    httpx.Response(200, json=["not", "a", "dict"]),
    httpx.Response(200, json={"signed_url": ""}),
])
def test_signed_url_upstream_problems_are_502_without_secrets(monkeypatch, response):
    _mock_elevenlabs(monkeypatch, lambda req: response)
    res = client.get("/api/agent/signed-url")
    assert res.status_code == 502 and "sk-secretkey" not in res.text


def test_signed_url_network_error_is_502(monkeypatch):
    def down(req):
        raise httpx.ConnectError("connection refused sk-secretkey")

    _mock_elevenlabs(monkeypatch, down)
    res = client.get("/api/agent/signed-url")
    assert res.status_code == 502 and "sk-secretkey" not in res.text
