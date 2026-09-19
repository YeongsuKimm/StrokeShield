from fastapi.testclient import TestClient

from backend.main import app
from backend.routers import agent

client = TestClient(app)


def test_signed_url_returns_backend_result(monkeypatch):
    async def fake_signed_url(lang="en"):
        return "wss://signed.example/session"

    monkeypatch.setattr(agent, "get_signed_url", fake_signed_url)
    response = client.get("/api/agent/signed-url")

    assert response.status_code == 200
    assert response.json() == {"signedUrl": "wss://signed.example/session"}


def test_signed_url_fails_closed_when_unconfigured(monkeypatch):
    async def missing_configuration(lang="en"):
        raise agent.ElevenLabsConfigurationError("ElevenLabs agent is not configured")

    monkeypatch.setattr(agent, "get_signed_url", missing_configuration)
    response = client.get("/api/agent/signed-url")

    assert response.status_code == 503
    assert response.json()["detail"] == "ElevenLabs agent is not configured"


def test_language_picks_the_matching_agent(monkeypatch):
    seen = []

    async def fake_signed_url(lang="en"):
        seen.append(lang)
        return "wss://signed.example/" + lang

    monkeypatch.setattr(agent, "get_signed_url", fake_signed_url)
    assert client.get("/api/agent/signed-url").json() == {"signedUrl": "wss://signed.example/en"}
    assert client.get("/api/agent/signed-url?lang=es").json() == {"signedUrl": "wss://signed.example/es"}
    assert seen == ["en", "es"]


def test_an_unknown_language_is_rejected_not_passed_through():
    assert client.get("/api/agent/signed-url?lang=../../evil").status_code == 422
    assert client.get("/api/agent/signed-url?lang=fr").status_code == 422


def test_each_language_reads_its_own_agent_id(monkeypatch):
    from services import elevenlabs_service as svc

    monkeypatch.setenv("ELEVENLABS_AGENT_ID", "agent_en")
    monkeypatch.setenv("ELEVENLABS_AGENT_ID_ES", "agent_es")
    assert svc.agent_id_for("en") == "agent_en" and svc.agent_id_for("es") == "agent_es"
    monkeypatch.setenv("ELEVENLABS_AGENT_ID_ES", "")
    assert svc.agent_id_for("es") == ""  # never falls back to the English agent silently
