import pytest
from fastapi.testclient import TestClient

from backend.main import app
from services import twilio_service

client = TestClient(app)

BODY = {
    "reason": "user_request",
    "patient": {"name": "Sam"},
    "lastKnownWell": "20 minutes ago",
    "location": {"lat": 39.33, "lng": -76.62, "accuracyM": 12},
    "symptoms": ["one side of the smile lifts less"],
}


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("DEMO_PHONE_NUMBER", "+15555550100")
    monkeypatch.setenv("DRY_RUN", "true")
    monkeypatch.setattr(twilio_service, "_last_alert_at", None)


def test_health_reports_dry_run():
    assert client.get("/api/health").json() == {"ok": True, "dryRun": True, "demoMode": True}


def test_dry_run_sends_nothing():
    res = client.post("/api/alert", json=BODY).json()
    assert res["ok"] is True and res["dryRun"] is True and res["callSid"] is None


def test_rejects_destination_number_in_body():
    assert client.post("/api/alert", json={**BODY, "to": "+911"}).status_code == 422
    assert client.post("/api/alert", json={**BODY, "phone": "+911"}).status_code == 422


def test_requires_configured_demo_number(monkeypatch):
    monkeypatch.delenv("DEMO_PHONE_NUMBER")
    monkeypatch.setattr("backend.settings.load_dotenv", lambda *a, **k: None)
    res = client.post("/api/alert", json=BODY).json()
    assert res["ok"] is False and "DEMO_PHONE_NUMBER" in res["error"]


def test_risk_threshold_reason_is_rechecked_server_side():
    low = {**BODY, "reason": "risk_threshold", "risk": {"risk": 0.9, "threshold": 0.1, "triggered": True,
           "contributions": [{"test": "face", "weight": 0.6, "severity": 0.1, "confidence": 1, "contribution": 0.06}]}}
    res = client.post("/api/alert", json=low).json()
    assert res["ok"] is False and "below threshold" in res["error"]


def test_live_send_uses_only_env_number_and_rate_limits(monkeypatch):
    monkeypatch.setenv("DRY_RUN", "false")
    for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"):
        monkeypatch.setenv(k, "x" if k != "TWILIO_FROM_NUMBER" else "+15555550199")
    calls = []

    class Obj:
        def __init__(self, sid):
            self.sid = sid

    class FakeClient:
        def __init__(self, *a):
            self.calls = type("C", (), {"create": lambda _s, **kw: (calls.append(("call", kw)), Obj("CA1"))[1]})()
            self.messages = type("M", (), {"create": lambda _s, **kw: (calls.append(("sms", kw)), Obj("SM1"))[1]})()

    monkeypatch.setattr("twilio.rest.Client", FakeClient)
    first = client.post("/api/alert", json=BODY).json()
    assert first == {"ok": True, "dryRun": False, "callSid": "CA1", "smsSid": "SM1", "error": None}
    assert {kw["to"] for _, kw in calls} == {"+15555550100"}
    assert "maps.google.com/?q=39.33,-76.62" in calls[1][1]["body"]
    assert client.post("/api/alert", json=BODY).json()["ok"] is False  # rate limited
