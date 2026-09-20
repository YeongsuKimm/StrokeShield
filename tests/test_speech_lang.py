"""Spanish speech check: the `lang` form field, the English-only phoneme model, and conservative scoring without it.

Audio is SYNTHETIC (tests/audio_synth.py); nothing here says how real Spanish speech scores, only that the wiring is safe.
"""
import sys
import types
from functools import cache

import pytest
from fastapi.testclient import TestClient

import models
from backend.main import app
from backend.routers import speech
from backend.schemas import TestResult as SpeechResult
from models import config as C
from models.audio import FLAG_PHONEME_ENGLISH_ONLY, analyze_speech
from models.speech_features import count_syllables
from tests.audio_synth import healthy, impaired

client = TestClient(app)
URL = "/api/speech/analyze"
WAV = b"RIFF" + (1000).to_bytes(4, "little") + b"WAVE" + b"\x00" * 1000
ES = C.TARGET_PHRASE_ES


@cache
def wav(kind: str) -> bytes:
    return {"healthy": healthy, "impaired": impaired}[kind]().wav()


def install_counting_phoneme(monkeypatch):
    calls: list[str] = []
    mod = types.ModuleType("models.phoneme")

    def score_phonemes(samples, sr, phrase):
        calls.append(phrase)
        return None

    mod.score_phonemes = score_phonemes
    mod.phoneme_scoring_enabled = lambda: True
    monkeypatch.setitem(sys.modules, "models.phoneme", mod)
    monkeypatch.setattr(models, "phoneme", mod, raising=False)
    return calls


def test_spanish_phrase_is_the_agreed_sentence_and_has_18_syllables():
    assert ES == "No se le pueden enseñar trucos nuevos a un perro viejo."
    assert count_syllables(ES) == 18
    assert C.target_phrase_for("es") == ES and C.target_phrase_for("en") == C.TARGET_PHRASE


def test_phoneme_model_is_not_called_for_spanish(monkeypatch):
    calls = install_counting_phoneme(monkeypatch)
    r = analyze_speech(wav("healthy"), ES, lang="es")
    assert calls == []
    assert FLAG_PHONEME_ENGLISH_ONLY in r.flags
    assert "per" not in r.metrics


def test_phoneme_model_still_runs_for_english(monkeypatch):
    calls = install_counting_phoneme(monkeypatch)
    r = analyze_speech(wav("healthy"), C.TARGET_PHRASE)
    assert calls and FLAG_PHONEME_ENGLISH_ONLY not in r.flags


def test_spanish_severity_is_capped_so_it_cannot_reach_the_caution_band_alone():
    r = analyze_speech(wav("impaired"), ES, lang="es")
    assert not r.needs_retry
    assert r.severity <= C.NON_ENGLISH_SEVERITY_CAP
    # speech weight (0.5) x capped severity stays under the result screen's caution band (0.3)
    assert 0.5 * r.severity < 0.3
    # ...while the same audio scored as English is not capped
    assert analyze_speech(wav("impaired"), C.TARGET_PHRASE).severity > C.NON_ENGLISH_SEVERITY_CAP


def test_healthy_spanish_run_stays_at_the_healthy_anchor():
    r = analyze_speech(wav("healthy"), ES, lang="es")
    assert r.severity <= 0.15


@pytest.fixture
def fake_analyzer(monkeypatch):
    calls: list[tuple[str, str | None]] = []

    def analyze(wav: bytes, phrase: str, lang: str | None = None) -> SpeechResult:
        calls.append((phrase, lang))
        return SpeechResult(test="speech", severity=0.1, confidence=0.5, flags=[], started_at=1, duration_ms=1)

    monkeypatch.setattr(speech, "analyze_speech", analyze)
    return calls


def post(**form: str):
    return client.post(URL, files={"audio": ("a.wav", WAV, "audio/wav")}, data=form)


def test_lang_defaults_to_english_and_keeps_the_old_call_shape(fake_analyzer):
    assert post().status_code == 200
    assert fake_analyzer == [(C.TARGET_PHRASE, None)]


def test_lang_es_reaches_the_analyzer_with_the_spanish_default_phrase(fake_analyzer):
    assert post(lang="es").status_code == 200
    assert fake_analyzer == [(ES, "es")]
    assert post(lang="es", target_phrase=ES).status_code == 200
    assert fake_analyzer[-1] == (ES, "es")


@pytest.mark.parametrize("bad", ["fr", "EN", "es-MX", "en;es"])
def test_any_other_lang_is_422_and_nothing_is_analyzed(fake_analyzer, bad):
    assert post(lang=bad).status_code == 422
    assert fake_analyzer == []
