"""The optional phoneme model is warmed at startup only when enabled, and can never break startup."""
import sys
from types import SimpleNamespace

from fastapi.testclient import TestClient

from backend.main import app


def _fake_phoneme(monkeypatch, enabled, calls, raises=False, ready=True):
    def warmup():
        calls.append("warmup")
        if raises:
            raise RuntimeError("boom")
        return ready

    fake = SimpleNamespace(phoneme_scoring_enabled=lambda: enabled, warmup=warmup)
    monkeypatch.setitem(sys.modules, "models.phoneme", fake)
    import models

    monkeypatch.setattr(models, "phoneme", fake, raising=False)


def test_warms_the_model_when_enabled(monkeypatch):
    calls: list[str] = []
    _fake_phoneme(monkeypatch, True, calls)
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200
    assert calls == ["warmup"]


def test_does_not_load_anything_when_disabled(monkeypatch):
    calls: list[str] = []
    _fake_phoneme(monkeypatch, False, calls)
    with TestClient(app):
        pass
    assert calls == []


def test_a_failing_warmup_does_not_break_startup(monkeypatch):
    calls: list[str] = []
    _fake_phoneme(monkeypatch, True, calls, raises=True)
    with TestClient(app) as client:
        assert client.get("/api/health").json()["ok"] is True
    assert calls == ["warmup"]


def test_an_unsuccessful_warmup_is_logged_and_does_not_break_startup(monkeypatch, caplog):
    calls: list[str] = []
    _fake_phoneme(monkeypatch, True, calls, ready=False)
    with caplog.at_level("WARNING", logger="strokeshield.startup"):
        with TestClient(app) as client:
            assert client.get("/api/health").json()["ok"] is True
    assert calls == ["warmup"]
    assert "did not warm up" in caplog.text


def test_missing_phoneme_module_does_not_break_startup(monkeypatch):
    monkeypatch.setitem(sys.modules, "models.phoneme", None)  # makes the import raise ImportError
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200
