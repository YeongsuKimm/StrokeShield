from fastapi.testclient import TestClient

from backend.main import app
from backend.routers import agent


client = TestClient(app)


def test_signed_url_returns_backend_result(monkeypatch):
    async def fake_signed_url():
        return "wss://signed.example/session"

    monkeypatch.setattr(agent, "get_signed_url", fake_signed_url)
    response = client.get("/api/agent/signed-url")

    assert response.status_code == 200
    assert response.json() == {"signedUrl": "wss://signed.example/session"}


def test_signed_url_fails_closed_when_unconfigured(monkeypatch):
    async def missing_configuration():
        raise agent.ElevenLabsConfigurationError("ElevenLabs agent is not configured")

    monkeypatch.setattr(agent, "get_signed_url", missing_configuration)
    response = client.get("/api/agent/signed-url")

    assert response.status_code == 503
    assert response.json()["detail"] == "ElevenLabs agent is not configured"
