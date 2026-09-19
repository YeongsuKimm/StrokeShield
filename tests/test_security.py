"""Privacy/abuse hardening: response headers, CORS, body caps, rate limits, log hygiene, no secrets in errors."""
import io
import logging

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import security
from backend.main import app
from services import elevenlabs_service, twilio_service

client = TestClient(app)

ALERT = {"reason": "user_request", "patient": {"name": "Sam"}, "symptoms": ["droop"]}


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("DEMO_PHONE_NUMBER", "+15555550100")
    monkeypatch.setattr(twilio_service, "_last_alert_at", None)


# ---------- response headers ----------

@pytest.mark.parametrize("method,path,kw", [
    ("get", "/api/health", {}),
    ("post", "/api/alert", {"json": ALERT}),
    ("post", "/api/alert", {"json": {"bad": 1}}),  # 422
    ("get", "/api/nope", {}),  # 404
    ("get", "/api/agent/signed-url", {}),  # 503 (unconfigured)
])
def test_hardening_headers_on_every_api_response(monkeypatch, method, path, kw):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.delenv("ELEVENLABS_AGENT_ID", raising=False)
    h = getattr(client, method)(path, **kw).headers
    assert h["cache-control"] == "no-store"
    assert h["x-content-type-options"] == "nosniff"
    assert h["referrer-policy"] == "no-referrer"
    assert h["x-frame-options"] == "DENY"
    pp = h["permissions-policy"]
    assert all(f"{f}=()" in pp for f in ("camera", "microphone", "geolocation"))
    assert "frame-ancestors 'none'" in h["content-security-policy"]


def test_error_replies_from_middleware_also_carry_headers():
    res = client.post("/api/alert", content=b"x" * (security.DEFAULT_BODY_LIMIT + 1))
    assert res.status_code == 413 and res.headers["cache-control"] == "no-store"


# ---------- CORS ----------

def test_cors_allows_only_configured_origin_methods_and_headers():
    ok = client.options("/api/alert", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type"})
    assert ok.status_code == 200
    assert ok.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "DELETE" not in ok.headers["access-control-allow-methods"]
    allowed = ok.headers["access-control-allow-headers"].lower()  # Starlette always adds the CORS-safelisted names
    assert "content-type" in allowed and "authorization" not in allowed and "*" not in allowed

    bad_origin = client.options("/api/alert", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in bad_origin.headers
    bad_header = client.options("/api/alert", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-api-key"})
    assert bad_header.status_code == 400
    bad_method = client.options("/api/alert", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "DELETE"})
    assert bad_method.status_code == 400


# ---------- body caps ----------

def test_second_opinion_body_is_capped():
    big = b'{"images":[{"kind":"face","jpegBase64":"' + b"A" * security.BODY_LIMITS["/api/vision/second-opinion"] + b'"}]}'
    res = client.post("/api/vision/second-opinion", content=big, headers={"content-type": "application/json"})
    assert res.status_code == 413


def test_small_second_opinion_body_is_still_accepted():
    body = {"images": [{"kind": "face", "jpegBase64": "AAAA"}]}
    assert client.post("/api/vision/second-opinion", json=body).status_code == 200


def test_cap_applies_to_streamed_bodies_without_content_length():
    def chunks():
        for _ in range(5):
            yield b"x" * (20 * 1024)  # 100 KB total > 64 KB default cap; a generator is sent chunked (no content-length)

    res = client.post("/api/alert", content=chunks(), headers={"content-type": "application/json"})
    assert res.status_code == 413


def test_speech_cap_unchanged():
    wav = b"RIFF" + b"\0" * 8 + b"x" * (5 * 1024 * 1024 + 100 * 1024)
    res = client.post("/api/speech/analyze", files={"audio": ("a.wav", io.BytesIO(wav), "audio/wav")})
    assert res.status_code == 413


# ---------- rate limits ----------

def test_rate_limit_returns_429_with_retry_hint_and_no_pii(monkeypatch):
    monkeypatch.setitem(security.RATE_LIMITS, "/api/alert", (3, 60.0))
    codes = [client.post("/api/alert", json=ALERT).status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]
    res = client.post("/api/alert", json=ALERT)
    assert int(res.headers["retry-after"]) >= 1
    assert "try again" in res.json()["detail"]
    assert "Sam" not in res.text and "testclient" not in res.text


def test_rate_limit_is_per_client_and_per_endpoint():
    lim = security.RateLimiter()
    assert lim.check("a", "/p", 1, 60, now=0) == 0
    assert lim.check("a", "/p", 1, 60, now=1) > 0
    assert lim.check("b", "/p", 1, 60, now=1) == 0  # other client
    assert lim.check("a", "/q", 1, 60, now=1) == 0  # other endpoint
    assert lim.check("a", "/p", 1, 60, now=61) == 0  # window slid


def test_rate_limiter_memory_is_bounded(monkeypatch):
    monkeypatch.setattr(security, "MAX_TRACKED_KEYS", 50)
    lim = security.RateLimiter()
    for i in range(500):
        lim.check(f"ip{i}", "/p", 5, 60, now=float(i) / 100)
    assert len(lim._hits) <= 50


def test_only_expensive_endpoints_are_limited_and_limits_are_generous():
    assert set(security.RATE_LIMITS) == {
        "/api/speech/analyze", "/api/vision/second-opinion", "/api/agent/signed-url", "/api/alert"}
    assert all(limit >= 10 for limit, _window in security.RATE_LIMITS.values())
    assert all(client.get("/api/health").status_code == 200 for _ in range(60))


# ---------- log hygiene ----------

def test_access_log_filter_strips_query_and_client_address():
    rec = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                            ("203.0.113.9:5555", "GET", "/api/x?name=Sam&phone=555", "1.1", 200), None)
    security.AccessLogPrivacyFilter().filter(rec)
    line = rec.getMessage()
    assert "Sam" not in line and "555" not in line and "203.0.113.9" not in line and "/api/x" in line


def test_access_log_filter_is_installed_and_outbound_loggers_are_quiet():
    security.install_log_privacy()
    assert any(isinstance(f, security.AccessLogPrivacyFilter) for f in logging.getLogger("uvicorn.access").filters)
    assert logging.getLogger("httpx").getEffectiveLevel() >= logging.WARNING


def test_unhandled_error_is_generic_and_logs_only_the_type(monkeypatch, caplog):
    def boom(_req):
        raise ValueError("secret patient Sam at 39.33,-76.62")

    monkeypatch.setattr("backend.routers.alert.place_alert", boom)
    with caplog.at_level(logging.DEBUG):
        res = client.post("/api/alert", json=ALERT)
    assert res.status_code == 500 and res.json() == {"detail": "internal error"}
    assert "Sam" not in res.text and "Sam" not in caplog.text and "39.33" not in caplog.text
    assert "ValueError" in caplog.text


def test_speech_endpoint_logs_no_content(caplog):
    with caplog.at_level(logging.DEBUG):
        client.post("/api/speech/analyze", data={"target_phrase": "Sam lives at 12 Elm Street"},
                    files={"audio": ("a.wav", io.BytesIO(b"not a wav"), "audio/wav")})
    assert "Elm" not in caplog.text and "Sam" not in caplog.text


def test_speech_failure_logs_only_the_error_type(monkeypatch, caplog):
    from backend.routers import speech

    def boom(_data, _phrase):
        raise RuntimeError("decoded text: Sam Elm Street")

    monkeypatch.setattr(speech, "analyze_speech", boom)
    wav = b"RIFF\0\0\0\0WAVE" + b"\0" * 64
    with caplog.at_level(logging.DEBUG):
        res = client.post("/api/speech/analyze", files={"audio": ("a.wav", io.BytesIO(wav), "audio/wav")})
    assert res.status_code == 200 and res.json()["needsRetry"] is True
    assert "Elm" not in caplog.text and "RuntimeError" in caplog.text


# ---------- secrets never echoed ----------

SECRETS = ("sk_SECRET_ELEVEN_KEY", "agent_SECRET_ID", "AC_SECRET_SID", "SECRET_TWILIO_TOKEN", "+15550009999")


class _Boom:
    """Stand-in for httpx.AsyncClient whose failure text carries the key and agent id."""

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, **kw):
        raise httpx.ConnectError(f"failed {url} {kw}")


class _Rejected(_Boom):
    async def get(self, url, **kw):
        return httpx.Response(401, text="bad key sk_SECRET_ELEVEN_KEY")


def test_agent_errors_never_echo_env_values_or_exception_text(monkeypatch, caplog):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "sk_SECRET_ELEVEN_KEY")
    monkeypatch.setenv("ELEVENLABS_AGENT_ID", "agent_SECRET_ID")

    monkeypatch.setattr(elevenlabs_service.httpx, "AsyncClient", _Boom)
    with caplog.at_level(logging.DEBUG):
        res = client.get("/api/agent/signed-url")
    assert res.status_code == 502
    for s in SECRETS:
        assert s not in res.text and s not in caplog.text

    monkeypatch.setattr(elevenlabs_service.httpx, "AsyncClient", _Rejected)
    with caplog.at_level(logging.DEBUG):
        res = client.get("/api/agent/signed-url")
    assert res.status_code == 502 and "SECRET" not in res.text and "SECRET" not in caplog.text


def test_agent_unconfigured_error_has_no_values(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "sk_SECRET_ELEVEN_KEY")
    monkeypatch.delenv("ELEVENLABS_AGENT_ID", raising=False)
    res = client.get("/api/agent/signed-url")
    assert res.status_code == 503 and "SECRET" not in res.text


def test_alert_errors_never_echo_env_values(monkeypatch, caplog):
    monkeypatch.setenv("DRY_RUN", "false")
    monkeypatch.setenv("DEMO_PHONE_NUMBER", "+15550009999")
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC_SECRET_SID")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "SECRET_TWILIO_TOKEN")
    monkeypatch.setenv("TWILIO_FROM_NUMBER", "+15550008888")

    class FakeClient:
        def __init__(self, sid, token):
            self.messages = self

        def create(self, **kw):
            raise RuntimeError(f"auth failed for AC_SECRET_SID/SECRET_TWILIO_TOKEN to +15550009999 {kw}")

    monkeypatch.setattr("twilio.rest.Client", FakeClient)
    with caplog.at_level(logging.DEBUG):
        res = client.post("/api/alert", json=ALERT)
    assert res.status_code == 200 and res.json()["ok"] is False
    for s in (*SECRETS, "+15550008888", "Sam"):
        assert s not in res.text and s not in caplog.text

    # Not configured / bad number: constant messages, no values
    monkeypatch.delenv("TWILIO_AUTH_TOKEN")
    res = client.post("/api/alert", json=ALERT)
    assert "SECRET" not in res.text and "+1555" not in res.text
    monkeypatch.setenv("DEMO_PHONE_NUMBER", "bad-SECRET-number")
    res = client.post("/api/alert", json=ALERT)
    assert "SECRET" not in res.text


def test_alert_validation_errors_do_not_reflect_server_env(monkeypatch):
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "SECRET_TWILIO_TOKEN")
    res = client.post("/api/alert", json={"reason": "nope"})
    assert res.status_code == 422 and "SECRET" not in res.text


def test_dry_run_alert_logs_no_pii(caplog):
    with caplog.at_level(logging.DEBUG):
        client.post("/api/alert", json={**ALERT, "location": {"lat": 39.33, "lng": -76.62}, "lastKnownWell": "10 min ago"})
    assert "Sam" not in caplog.text and "39.33" not in caplog.text and "+1555" not in caplog.text


def test_sms_body_contains_only_the_spec_fields():
    from backend.schemas import AlertRequest

    req = AlertRequest.model_validate({**ALERT, "lastKnownWell": "10 min ago", "location": {"lat": 1.5, "lng": 2.5, "accuracyM": 10}})
    assert twilio_service.build_message(req) == (
        "StrokeShield ALERT: possible stroke. Symptoms: droop. Patient: Sam. Last known well: 10 min ago. "
        "Location: https://maps.google.com/?q=1.5,2.5 (±10 m). Demo message.")
