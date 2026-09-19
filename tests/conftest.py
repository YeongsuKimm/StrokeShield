"""Test isolation: a developer's local .env must never change test outcomes.

backend.settings loads `.env` at import (python-dotenv does NOT override variables that are already set), so pinning the
behaviour-changing settings here, before anything imports backend, makes every run identical on every machine. Tests that
need a different value set it themselves with monkeypatch.setenv.
"""
import os

import pytest

PINNED = {
    "PHONEME_SCORING": "false",  # real PyTorch scoring would change severities (needs torch + a 378 MB model)
    "DRY_RUN": "true",  # never place a real call/SMS from a test
    "DEMO_MODE": "true",
    "GEMINI_API_KEY": "",  # a local key must never make a test call the real Gemini API
}
for _k, _v in PINNED.items():
    os.environ[_k] = _v
os.environ.pop("PHONEME_THREADS", None)


@pytest.fixture(autouse=True)
def _pin_env(monkeypatch):
    for k, v in PINNED.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("PHONEME_THREADS", raising=False)
