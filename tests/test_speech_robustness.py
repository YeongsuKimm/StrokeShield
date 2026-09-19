"""Robustness of the speech pipeline for unknown voices, rooms and microphones (docs/spec/03-speech.md "Robustness").

Two layers:
* always-on tests: synthetic speech-like audio (tests/audio_synth.py) put through room / mic / capture perturbations
  (tests/audio_variants.py), plus a FAKE phoneme model to drive the agreement, trust, mismatch and fallback rules;
* optional tests: the REAL wav2vec2 model on TTS renders of the sentence, skipped when torch, the phoneme model or the TTS
  model is not in the local cache (they need `PHONEME_SCORING`; conftest pins it off, so they switch it on themselves).

Nothing here is real human speech: it proves graceful degradation, not accuracy. All thresholds remain UNCALIBRATED.
"""
import io
import os
import sys
import threading
import types
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

import models
import tests.audio_variants as V
from backend.main import app
from backend.routers import speech
from backend.schemas import TestResult as SpeechResult
from models import config as C
from models.audio import (
    analyze_speech,
    edge_missing,
    phoneme_trust,
    score_metrics,
    severity_cap,
)
from tests.audio_synth import borderline, healthy, impaired, synth_speech, to_wav_bytes

PHRASE = "You can't teach an old dog new tricks."
HEALTHY_MAX = 0.20  # robustness ceiling for a healthy speaker under bad conditions (clean anchor is <= 0.15, test_audio_scoring)


def run(samples: np.ndarray) -> SpeechResult:
    return analyze_speech(to_wav_bytes(samples), PHRASE)


def counted_as_healthy(r: SpeechResult) -> bool:
    """Not flagged: either a low severity, or a retry / low-confidence result that the app drops (never a confident verdict)."""
    return r.needs_retry or r.severity <= HEALTHY_MAX or r.confidence < C.MIN_CONFIDENCE


# ---------------------------------------------------------------- healthy people in bad conditions (DSP only)
BASE = healthy().samples
BG = synth_speech(n_syllables=14, syllable_rate=4.0, f0_hz=180, seed=9, snr_db=60).samples  # someone else talking / TV
HEALTHY_VARIANTS = {
    "white noise 25 dB": lambda x: V.add_noise(x, 25),
    "white noise 15 dB": lambda x: V.add_noise(x, 15),
    "white noise 12 dB": lambda x: V.add_noise(x, 12),
    "pink noise 15 dB": lambda x: V.add_noise(x, 15, "pink"),
    "fan/hum 15 dB": lambda x: V.add_noise(x, 15, "hum"),
    "music 12 dB": lambda x: V.add_background(x, V.music(len(x)), 12),
    "reverb 0.3 s": lambda x: V.reverb(x, 0.3),
    "reverb 0.6 s": lambda x: V.reverb(x, 0.6),
    "reverb 1.0 s": lambda x: V.reverb(x, 1.0),
    "laptop mic": lambda x: V.add_noise(V.bandlimit(x, 200, 5500), 28),
    "cheap mic + noise": lambda x: V.add_noise(V.bandlimit(x, 250, 4500), 18, "pink"),
    "bluetooth headset": lambda x: V.add_noise(V.bluetooth_sco(x), 28),
    "48 kHz device": lambda x: V.roundtrip_rate(x, 48000),
    "44.1 kHz device": lambda x: V.roundtrip_rate(x, 44100),
    "soft voice -34 dBFS": lambda x: V.add_noise(V.set_level(x, -34), 32),
    "cough mid-sentence": lambda x: V.cough(x, 1.2),
    "short natural pause 0.8 s": lambda x: V.insert_pause(x, 1.0, 0.8, 1e-4),
    "TV in background 20 dB": lambda x: V.add_background(x, BG, 20),
    "moderate clipping": lambda x: V.clip_hard(V.set_level(x, -22), 3.0),
}


@pytest.mark.parametrize("name", list(HEALTHY_VARIANTS))
def test_healthy_speaker_is_not_flagged_in_bad_conditions(name):
    r = run(HEALTHY_VARIANTS[name](BASE))
    assert counted_as_healthy(r), (name, r.severity, r.confidence, r.flags)


def test_noisy_room_never_yields_a_confident_high_severity():
    """Even a genuinely impaired-looking clip in a noisy room is capped and low-confidence: 'retry in a quiet room', not a verdict."""
    x = V.add_noise(impaired().samples, 12)
    r = run(x)
    assert r.needs_retry or (r.severity <= C.POOR_CONDITIONS_SEVERITY_CAP and r.confidence < 0.6)
    if not r.needs_retry:
        assert any("noisy room" in f for f in r.flags)


def test_impaired_synthetic_clip_still_scores_high_in_a_reasonable_room():
    r = run(V.add_noise(impaired().samples, 30))
    assert not r.needs_retry and r.severity >= 0.85
    assert score_metrics(r.metrics).cap_reason == ""


def test_borderline_anchor_is_kept():
    r = analyze_speech(borderline().wav(), PHRASE)
    assert 0.25 <= r.severity <= 0.55


# ---------------------------------------------------------------- agreement rule (pure)
def test_quality_signals_alone_are_capped_and_timing_corroboration_lifts_the_cap():
    quality_only = {"articulation_rate": 4.5, "longest_pause_s": 0.1, "pause_ratio": 0.05, "f0_sd_semitones": 3.0,
                    "per": 0.6, "gop_mean": -4.5, "jitter_rap": 0.03, "shimmer_apq3": 0.08}
    s = score_metrics(quality_only)
    assert s.uncapped_severity > 0.4 and s.severity == C.QUALITY_ONLY_CAP and s.cap_reason == "quality-only"
    slow = {**quality_only, "articulation_rate": 1.6, "longest_pause_s": 1.0, "pause_ratio": 0.4}
    s2 = score_metrics(slow)
    assert s2.severity == s2.uncapped_severity and s2.severity >= 0.85 and s2.cap_reason == ""


def test_a_lone_timing_signal_is_capped_by_its_own_reliability():
    assert severity_cap({"prosody": 1.0}) == (C.TIMING_ONLY_CAP["prosody"], "timing-only")  # monotone reader
    assert severity_cap({"pausing": 1.0, "rate": 0.05}) == (C.TIMING_ONLY_CAP["pausing"], "timing-only")  # a long thinking pause
    assert severity_cap({"pausing": 1.0, "rate": 0.5})[0] is None
    assert severity_cap({"rate": 0.9, "voice_quality": 0.25})[0] is None
    assert severity_cap({"rate": 0.1, "voice_quality": 0.1}) == (C.NO_SIGNAL_CAP, "no-signal")


def test_quality_only_flags_are_not_headlined():
    x = V.reverb(BASE, 0.6)
    r = run(x)
    comps = score_metrics(r.metrics).components
    if severity_cap(comps)[1] == "quality-only":  # reverb moved only the quality group here: no headline flags for it
        assert not any(f == "rough or breathy voice" or f.startswith("unclear sounds") for f in r.flags)


def test_phoneme_trust_falls_with_noise_and_insertions():
    assert phoneme_trust(40) == 1.0
    assert phoneme_trust(20) < phoneme_trust(30) <= 1.0
    assert phoneme_trust(10) == C.PHONEME_TRUST_FLOOR
    assert phoneme_trust(40, 2.0) == C.PHONEME_INSERTION_TRUST
    assert phoneme_trust(40, 1.0) == 1.0


def test_edge_missing_reads_lost_start_or_end_not_slurring():
    ok = [("a", -0.1)] * 20
    assert edge_missing(ok) == (False, False)
    assert edge_missing([("a", -9.0)] * 3 + ok) == (True, False)
    assert edge_missing(ok + [("a", -9.0)] * 3) == (False, True)
    assert edge_missing([("a", -9.0)] * 3 + ok + [("a", -9.0)] * 3) == (True, True)
    assert edge_missing([("a", -9.0)] * 20) == (False, False)  # everything bad: mumble/other sentence, not a lost edge
    assert edge_missing([("a", -9.0), ("b", -9.0)]) == (False, False)  # too short to say


# ---------------------------------------------------------------- capture failures -> specific retry messages
def reason(samples: np.ndarray) -> str:
    r = run(samples)
    assert r.needs_retry and r.confidence < C.MIN_CONFIDENCE and r.severity == 0
    return r.flags[0]


def test_mic_muted_or_silent_says_too_quiet():
    assert "too quiet" in reason(np.zeros(4 * 16000, np.float32))
    assert "too quiet" in reason((np.random.default_rng(0).standard_normal(4 * 16000) * 1e-5).astype(np.float32))


def test_very_quiet_speech_says_too_quiet():
    assert "too quiet" in reason(V.set_level(BASE, -62))


def test_clipping_says_too_loud():
    assert "too loud" in reason(V.clip_hard(V.set_level(BASE, -22), 12.0))


def test_room_noise_without_speech_says_background_noise():
    noise = np.random.default_rng(1).standard_normal(4 * 16000) * 0.01
    assert "background noise" in reason(noise.astype(np.float32))
    assert "background noise" in reason((0.1 * np.sin(2 * np.pi * 440 * np.arange(4 * 16000) / 16000)).astype(np.float32))


def test_too_short_and_too_long_clips_say_so():
    assert "too short" in reason(BASE[: int(1.0 * 16000)])
    long = np.tile(BASE, 7)
    assert long.size / 16000 > C.MAX_ACCEPT_S
    assert "too long" in reason(long)


def test_garbage_bytes_never_raise():
    for junk in (b"", b"RIFF", b"RIFF" + b"\x00" * 100, os.urandom(5000), b"RIFF\xff\xff\xff\xffWAVEfmt " + b"\xff" * 64):
        r = analyze_speech(junk, PHRASE)
        assert r.needs_retry and r.flags and r.severity == 0


def test_a_lone_click_or_cough_is_not_enough_speech():
    x = np.zeros(4 * 16000, np.float32)
    x = V.cough(x + 1e-5 * np.random.default_rng(0).standard_normal(x.size).astype(np.float32), 1.5, rel_level=1.0)
    r = run(V.set_level(x, -22) if np.max(np.abs(x)) > 0 else x)
    assert r.needs_retry or r.severity <= HEALTHY_MAX


def test_stereo_and_other_rates_are_accepted():
    import soundfile as sf

    stereo = np.stack([BASE, BASE], axis=1)
    buf = io.BytesIO()
    sf.write(buf, stereo, 16000, format="WAV", subtype="PCM_16")
    r48 = analyze_speech(buf.getvalue(), PHRASE)
    assert not r48.needs_retry and r48.severity <= HEALTHY_MAX
    buf = io.BytesIO()
    sf.write(buf, V.roundtrip_rate(BASE, 48000), 16000, format="WAV", subtype="FLOAT")
    assert not analyze_speech(buf.getvalue(), PHRASE).needs_retry


# ---------------------------------------------------------------- fake phoneme model: agreement / trust / fallback
def install_phoneme(monkeypatch, result=None, *, enabled=True, sleep_s: float = 0.0, raises: Exception | None = None):
    mod = types.ModuleType("models.phoneme")

    def score_phonemes(samples, sr, phrase):
        if sleep_s:
            import time

            time.sleep(sleep_s)
        if raises:
            raise raises
        return result

    mod.score_phonemes = score_phonemes
    mod.phoneme_scoring_enabled = lambda: enabled
    monkeypatch.setitem(sys.modules, "models.phoneme", mod)
    monkeypatch.setattr(models, "phoneme", mod, raising=False)


def ph(per, gop, *, decoded_n=22, per_phone=None):
    return SimpleNamespace(per=per, gop_mean=gop, gop_min=gop - 1, n_bad_phones=3, bad_phones=["k", "t", "n"], decoded=" ".join(["x"] * decoded_n),
                           target=" ".join(["y"] * 22), per_phone=per_phone or [])


def test_bad_articulation_on_healthy_timing_is_capped(monkeypatch):
    install_phoneme(monkeypatch, ph(0.6, -4.5))
    r = analyze_speech(healthy().wav(), PHRASE)
    assert not r.needs_retry and r.severity <= C.QUALITY_ONLY_CAP
    assert not any(f.startswith("unclear sounds") for f in r.flags)
    assert r.metrics["per"] == pytest.approx(0.6)


def test_bad_articulation_with_slow_halting_timing_still_scores_high(monkeypatch):
    install_phoneme(monkeypatch, ph(0.6, -4.5))
    r = analyze_speech(impaired().wav(), PHRASE)
    assert r.severity >= 0.85


def test_a_different_sentence_is_a_specific_retry_not_a_severity(monkeypatch):
    install_phoneme(monkeypatch, ph(0.95, -8.0))
    r = analyze_speech(healthy().wav(), PHRASE)
    assert r.needs_retry and "didn't sound like the sentence" in r.flags[0] and r.severity == 0


def test_background_voices_are_a_specific_retry(monkeypatch):
    install_phoneme(monkeypatch, ph(1.3, -2.4, decoded_n=44))
    r = analyze_speech(healthy().wav(), PHRASE)
    assert r.needs_retry and "other voices" in r.flags[0]


def test_slow_halting_speaker_is_scored_even_if_phoneme_checks_look_off(monkeypatch):
    """The retry escapes only fire when timing shows nothing: a real slow speaker is never stuck in a 'move somewhere quiet' loop."""
    install_phoneme(monkeypatch, ph(1.3, -7.0, decoded_n=44))
    r = analyze_speech(impaired().wav(), PHRASE)
    assert not r.needs_retry and r.severity >= 0.85


def test_lost_start_of_sentence_lowers_trust_and_is_flagged_not_penalised(monkeypatch):
    pp = [("a", -9.5)] * 3 + [("b", -0.1)] * 19
    install_phoneme(monkeypatch, ph(0.18, -1.8, per_phone=pp))
    r = analyze_speech(healthy().wav(), PHRASE)
    assert not r.needs_retry and r.severity <= 0.05
    assert r.metrics["phoneme_trust"] <= C.PHONEME_EDGE_TRUST
    assert any("start of the sentence may be missing" in f for f in r.flags)


def test_low_trust_phoneme_does_not_raise_the_confidence_ceiling(monkeypatch):
    install_phoneme(monkeypatch, ph(0.1, -0.5))
    trusted = analyze_speech(healthy().wav(), PHRASE)
    noisy = run(V.add_noise(BASE, 16, "pink"))
    assert trusted.confidence > 0.8 and noisy.confidence < trusted.confidence


@pytest.mark.parametrize("kw", [dict(result=None), dict(raises=RuntimeError("torch exploded"))])
def test_enabled_but_unavailable_phoneme_falls_back_to_dsp_with_a_flag(monkeypatch, kw):
    install_phoneme(monkeypatch, **kw)
    r = analyze_speech(healthy().wav(), PHRASE)
    assert not r.needs_retry and "per" not in r.metrics and r.severity <= 0.15
    assert any("phoneme check unavailable" in f for f in r.flags)
    assert r.confidence <= C.CONFIDENCE_CEILING["acoustic"]


def test_disabled_phoneme_is_silent(monkeypatch):
    install_phoneme(monkeypatch, ph(0.9, -9.0), enabled=False)
    r = analyze_speech(healthy().wav(), PHRASE)
    assert "per" not in r.metrics and not any("phoneme" in f for f in r.flags)


def test_slow_phoneme_model_times_out_to_dsp_only(monkeypatch):
    monkeypatch.setattr(C, "PHONEME_TIMEOUT_S", 0.2)
    install_phoneme(monkeypatch, ph(0.1, -0.5), sleep_s=1.5)
    import time

    t0 = time.perf_counter()
    r = analyze_speech(healthy().wav(), PHRASE)
    assert time.perf_counter() - t0 < 1.2
    assert not r.needs_retry and "per" not in r.metrics and any("phoneme check unavailable" in f for f in r.flags)


# ---------------------------------------------------------------- concurrency + endpoint limits
def test_simultaneous_analyses_do_not_share_state():
    clips = {"healthy": healthy().wav(), "impaired": impaired().wav(), "borderline": borderline().wav(),
             "noisy": to_wav_bytes(V.add_noise(BASE, 14))}
    serial = {k: analyze_speech(v, PHRASE) for k, v in clips.items()}
    out: dict[str, SpeechResult] = {}

    def work(k: str) -> None:
        for _ in range(3):
            out[k] = analyze_speech(clips[k], PHRASE)

    threads = [threading.Thread(target=work, args=(k,)) for k in clips]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    for k, r in out.items():
        assert r.severity == serial[k].severity and r.confidence == serial[k].confidence and r.flags == serial[k].flags, k


def test_endpoint_concurrent_requests_all_answer(monkeypatch):
    client = TestClient(app)
    data = healthy().wav()
    results: list[dict] = []

    def post() -> None:
        results.append(client.post("/api/speech/analyze", files={"audio": ("a.wav", data, "audio/wav")}).json())

    threads = [threading.Thread(target=post) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(results) == 6 and all(not r["needsRetry"] and r["severity"] <= 0.15 for r in results)


def test_endpoint_busy_returns_a_retry_not_an_error(monkeypatch):
    monkeypatch.setattr(speech, "SLOT_WAIT_S", 0.05)
    held = [speech._SLOTS.acquire() for _ in range(speech.MAX_CONCURRENT_ANALYSES)]
    try:
        res = TestClient(app).post("/api/speech/analyze", files={"audio": ("a.wav", healthy().wav(), "audio/wav")})
    finally:
        for _ in held:
            speech._SLOTS.release()
    body = res.json()
    assert res.status_code == 200 and body["needsRetry"] is True and "busy" in body["flags"][0]


def test_upload_is_not_logged_or_persisted(caplog, tmp_path, monkeypatch):
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    with caplog.at_level("DEBUG"):
        res = TestClient(app).post("/api/speech/analyze", files={"audio": ("a.wav", healthy().wav(), "audio/wav")})
    assert res.status_code == 200
    text = " ".join(r.getMessage() for r in caplog.records)
    assert "RIFF" not in text and "WAVE" not in text
    assert list(tmp_path.iterdir()) == []


# ---------------------------------------------------------------- REAL phoneme model on TTS renders (optional)
def _rss_mb() -> float:
    with open("/proc/self/status") as fh:
        return next(int(line.split()[1]) for line in fh if line.startswith("VmRSS")) / 1024


@pytest.fixture(scope="module")
def real_model():
    pytest.importorskip("torch")
    pytest.importorskip("transformers")
    os.environ["PHONEME_SCORING"] = "true"
    os.environ["HF_HUB_OFFLINE"] = "1"
    from models import phoneme

    if not phoneme.model_cached():
        pytest.skip("phoneme model not cached (python -m models.phoneme --download)")
    phoneme.warmup()
    yield phoneme
    os.environ["PHONEME_SCORING"] = "false"


@pytest.fixture(scope="module")
def tts(real_model):
    """facebook/mms-tts-eng renders of the phrase (cached in ~/.cache/huggingface); skipped when unavailable."""
    import torch
    from transformers import AutoTokenizer, VitsModel

    try:
        tok = AutoTokenizer.from_pretrained("facebook/mms-tts-eng", local_files_only=True)
        model = VitsModel.from_pretrained("facebook/mms-tts-eng", local_files_only=True).eval()
    except Exception:
        pytest.skip("MMS-TTS model not cached")

    def say(text: str, seed: int = 0) -> np.ndarray:
        torch.manual_seed(seed)
        with torch.no_grad():
            w = model(**tok(text, return_tensors="pt")).waveform[0].numpy().astype(np.float32)
        return V.pad(w / np.abs(w).max() * 0.5, 0.5, 0.8, floor=1e-4)

    return say


def test_real_model_healthy_tts_variants_are_not_flagged(tts, monkeypatch):
    monkeypatch.setenv("PHONEME_SCORING", "true")
    clean = V.set_level(tts("you can't teach an old dog new tricks"), -22)
    other = V.set_level(tts("the weather is nice today and i like it"), -22)
    tv = V.set_level(tts("so today we are going to talk about the news and the weather across the country"), -22)
    variants = {
        "clean": clean, "fast x1.25": V.stretch(clean, 1.25), "fast x1.4": V.stretch(clean, 1.4), "slow x0.8": V.stretch(clean, 0.8),
        "other voice 1.15": V.vocal_tract_shift(clean, 1.15), "other voice 0.87": V.vocal_tract_shift(clean, 0.87),
        "pitch -4": V.pitch_shift(clean, -4), "accent drift": V.accent_drift(clean),
        "soft -42": V.add_noise(V.set_level(clean, -42), 30), "white 18": V.add_noise(clean, 18), "white 11": V.add_noise(clean, 11),
        "pink 12": V.add_noise(clean, 12, "pink"), "reverb 0.6": V.reverb(clean, 0.6), "reverb 1.0": V.reverb(clean, 1.0),
        "laptop mic": V.add_noise(V.bandlimit(clean, 200, 5500), 28), "bluetooth": V.add_noise(V.bluetooth_sco(clean), 28),
        "48k": V.roundtrip_rate(clean, 48000), "cough": V.cough(clean, 1.4), "pause 0.8": V.insert_pause(clean, 1.6, 0.8, 1e-4),
        "tv 20": V.add_background(clean, tv, 20), "tv 6": V.add_background(clean, tv, 6),
        "word dropped": V.set_level(tts("you can't teach old dog new tricks"), -22),
        "word swapped": V.set_level(tts("you can't teach an old dog some tricks"), -22),
        "repeated word": V.set_level(tts("you can't teach an old dog new new tricks"), -22),
        "um": V.set_level(tts("you can't teach an um old dog new tricks"), -22),
        "end cut off": V.cut(clean, 0, 1.6), "start cut off": V.cut(clean, 0.9, 0),
        "other sentence": other,
    }
    bad = {}
    for name, x in variants.items():
        r = run(x)
        if not counted_as_healthy(r):
            bad[name] = (r.severity, r.confidence, r.flags)
    assert not bad, bad


def test_real_model_still_flags_slow_halting_tts(tts, monkeypatch):
    monkeypatch.setenv("PHONEME_SCORING", "true")
    clean = V.set_level(tts("you can't teach an old dog new tricks"), -22)
    slow = V.insert_pause(V.insert_pause(V.stretch(clean, 0.55), 1.5, 1.0, 1e-4), 3.2, 1.0, 1e-4)
    r = run(slow)
    assert not r.needs_retry and r.severity >= 0.6


def test_real_model_wrong_sentence_and_tv_only_are_retries_with_reasons(tts, monkeypatch):
    monkeypatch.setenv("PHONEME_SCORING", "true")
    r = run(V.set_level(tts("the weather is nice today and i like it"), -22))
    assert r.needs_retry and "didn't sound like the sentence" in r.flags[0]
    r = run(V.set_level(tts("so today we are going to talk about the news and the weather across the country"), -22))
    assert r.needs_retry


def test_real_model_repeated_calls_do_not_leak_and_overlap_safely(tts, monkeypatch):
    monkeypatch.setenv("PHONEME_SCORING", "true")
    x = V.set_level(tts("you can't teach an old dog new tricks"), -22)
    run(x)
    before = _rss_mb()
    for _ in range(12):
        assert not run(x).needs_retry
    assert _rss_mb() - before < 250  # torch keeps its arena; 12 further calls must not add another model's worth
    results: list[SpeechResult] = []
    threads = [threading.Thread(target=lambda: results.append(run(x))) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(results) == 3 and len({(r.severity, r.needs_retry) for r in results}) == 1
    assert all("per" in r.metrics or any("unavailable" in f for f in r.flags) for r in results)
