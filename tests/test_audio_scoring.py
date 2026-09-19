"""Scoring + orchestrator tests for models/audio.py (analyze_speech).

IMPORTANT: every audio signal here is SYNTHETIC speech-LIKE audio from tests/audio_synth.py (pulse train through
vowel filters), not speech. The "healthy <= 0.15" and "impaired >= 0.85" assertions prove the ramps, weights and
severity map are wired so that clearly-good/clearly-bad synthetic inputs land on the shared severity anchors. They
do NOT show real healthy vs real dysarthric speech separate that well; all thresholds are UNCALIBRATED guesses.
"""
import math
import sys
import time
import types
from functools import cache
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

import models
from backend.main import app
from backend.schemas import (
    TestResult as SpeechResult,  # aliased so pytest does not try to collect it
)
from models import config as C
from models.audio import analyze_speech, compute_confidence, score_metrics
from models.speech_features import ramp
from models.transcribe import Transcript, Word
from tests.audio_synth import (
    SR,
    borderline,
    fast_healthy,
    healthy,
    impaired,
    quiet_healthy,
    synth_speech,
    to_wav_bytes,
)

PHRASE = "You can't teach an old dog new tricks."
HEALTHY_METRICS = {
    "articulation_rate": 4.6, "longest_pause_s": 0.1, "pause_ratio": 0.05, "f0_sd_semitones": 3.0,
    "jitter_rap": 0.003, "shimmer_apq3": 0.02, "hnr_db": 20.0,
}


@cache
def wav(kind: str, **kw) -> bytes:
    fn = {"healthy": healthy, "fast": fast_healthy, "quiet": quiet_healthy, "borderline": borderline, "impaired": impaired, "raw": synth_speech}[kind]
    return fn(**dict(kw)).wav()


def run(kind: str, **kw) -> SpeechResult:
    return analyze_speech(wav(kind, **kw), PHRASE)


def check_valid(r: SpeechResult) -> None:
    assert r.test == "speech"
    assert 0 <= r.severity <= 1 and 0 <= r.confidence <= 1
    assert all(math.isfinite(v) for v in r.metrics.values())
    assert r.started_at > 1_600_000_000_000 and r.duration_ms >= 0
    assert r.flags or not r.needs_retry


def assert_retry(r: SpeechResult) -> None:
    check_valid(r)
    assert r.needs_retry is True and r.severity == 0.0
    assert 0 < r.confidence < C.MIN_CONFIDENCE
    reason = r.flags[0]
    assert reason == reason.lower() and not reason.endswith(".") and 0 < len(reason) < 80


# ---------------------------------------------------------------- severity anchors on synthetic audio
def test_healthy_synthetic_speakers_score_at_most_015_including_fast_and_quiet():
    for kind in ("healthy", "fast", "quiet"):
        r = run(kind)
        check_valid(r)
        assert not r.needs_retry
        assert r.severity <= 0.15, (kind, r.severity, r.flags)
        assert r.flags == [], (kind, r.flags)


def test_impaired_synthetic_speaker_scores_at_least_085():
    r = run("impaired")
    check_valid(r)
    assert not r.needs_retry
    assert r.severity >= 0.85
    for f in ("very slow articulation", "long pauses", "flat pitch"):
        assert f in r.flags


def test_borderline_synthetic_speaker_is_between_the_anchors():
    r = run("borderline")
    assert not r.needs_retry
    assert 0.25 <= r.severity <= 0.55  # borderline ~0.3-0.4: must not alert alone (speech maxWeight 0.5 * sev * conf < 0.5)


def test_severity_ordering_healthy_lt_borderline_lt_impaired():
    assert run("healthy").severity < run("borderline").severity < run("impaired").severity


def test_acoustic_only_confidence_is_capped_at_06():
    for kind in ("healthy", "borderline", "impaired"):
        assert run(kind).confidence <= 0.6 + 1e-9


# ---------------------------------------------------------------- scoring monotonicity through the whole pipeline
def test_slower_articulation_scores_higher():
    sev = [run("raw", syllable_rate=r, f0_sd_st=3.5, seed=1).severity for r in (4.5, 3.4, 2.6, 1.6)]
    assert sev == sorted(sev) and sev[-1] > sev[0] + 0.3


def test_more_pausing_scores_higher():
    sev = [analyze_speech(synth_speech(f0_sd_st=3.5, pauses=p, seed=1).wav(), PHRASE).severity for p in ({}, {3: 0.5}, {3: 0.9}, {2: 1.0, 5: 1.0})]
    assert sev == sorted(sev) and sev[-1] > sev[0] + 0.1  # pausing alone is only 0.15 of the weight: a single sign stays modest


def test_flatter_pitch_scores_higher():
    sev = [run("raw", f0_sd_st=v, seed=1).severity for v in (3.5, 1.5, 0.5, 0.0)]
    assert sev == sorted(sev) and sev[-1] >= sev[0]


def test_pause_metrics_recovered_end_to_end():
    r = analyze_speech(synth_speech(pauses={3: 0.8}, f0_sd_st=3.0, seed=2).wav(), PHRASE)
    assert r.metrics["longest_pause_s"] == pytest.approx(0.8, abs=0.1)
    assert r.metrics["n_long_pauses"] == 1


@pytest.mark.parametrize("rate", [3.0, 4.5, 6.0])
def test_articulation_rate_recovered_within_tolerance(rate):
    r = analyze_speech(synth_speech(syllable_rate=rate, seed=3).wav(), PHRASE)
    assert r.metrics["articulation_rate"] == pytest.approx(rate, rel=0.15)
    assert r.metrics["articulation_rate_nuclei"] == pytest.approx(rate, rel=0.2)


def test_metrics_include_the_spec_features_and_are_finite():
    r = run("healthy")
    for k in ("articulation_rate", "speech_rate_wps", "pause_ratio", "longest_pause_s", "n_long_pauses", "rhythm_var",
              "f0_sd_semitones", "f0_range_semitones", "jitter_local", "shimmer_local", "hnr_db", "intensity_sd_db", "voiced_fraction"):
        assert k in r.metrics, k
    assert all(math.isfinite(v) for v in r.metrics.values())
    assert r.transcript is None


# ---------------------------------------------------------------- score_metrics: ramps, weights, renormalization
def test_healthy_metrics_score_zero_and_all_abnormal_metrics_score_one():
    assert score_metrics(HEALTHY_METRICS).severity == 0.0
    bad = {"articulation_rate": 1.5, "longest_pause_s": 2.0, "pause_ratio": 0.6, "f0_sd_semitones": 0.1,
           "jitter_rap": 0.05, "shimmer_apq3": 0.1, "hnr_db": 3.0}
    assert score_metrics(bad).severity == 1.0


def test_first_clean_real_mic_metrics_do_not_false_alarm():
    # Anonymous metrics from the first real-mic healthy fixed-phrase run. The audio and personal sidecar stay ignored.
    metrics = {
        "articulation_rate": 2.6403,
        "longest_pause_s": 0.0,
        "pause_ratio": 0.0,
        "f0_sd_semitones": 1.9147,
        "jitter_rap": 0.0101,
        "shimmer_apq3": 0.0321,
        "hnr_db": 8.9651,
    }
    assert score_metrics(metrics).severity <= 0.15


def test_weights_are_renormalized_over_available_components():
    s = score_metrics(HEALTHY_METRICS)
    assert set(s.components) == {"rate", "pausing", "prosody", "voice_quality"}  # no intelligibility / articulation
    assert sum(s.weights.values()) == pytest.approx(1.0)
    assert s.weights["rate"] == pytest.approx(C.WEIGHTS["rate"] / sum(C.WEIGHTS[k] for k in s.components))


def test_missing_component_does_not_dilute_or_inflate_severity():
    only_rate_bad = {"articulation_rate": 1.0}
    s = score_metrics(only_rate_bad)
    assert s.components == {"rate": 1.0} and s.weights == {"rate": 1.0} and s.severity == 1.0
    # the same bad rate diluted by healthy other components is lower than when it is the only evidence
    assert score_metrics({**HEALTHY_METRICS, "articulation_rate": 1.0}).severity < s.severity


def test_intelligibility_needs_a_transcript_and_articulation_needs_phoneme_scores():
    assert "intelligibility" not in score_metrics(HEALTHY_METRICS).components
    with_cer = score_metrics({**HEALTHY_METRICS, "cer": 0.4})
    assert with_cer.components["intelligibility"] == 1.0 and "articulation" not in with_cer.components
    # PER is scored ONCE (articulation); it is deliberately NOT reused as an intelligibility proxy (no double counting)
    with_per = score_metrics({**HEALTHY_METRICS, "per": 0.7, "gop_mean": -4.5})
    assert "intelligibility" not in with_per.components and with_per.components["articulation"] == 1.0
    assert with_per.severity > score_metrics(HEALTHY_METRICS).severity


def test_cer_takes_precedence_over_per_for_intelligibility():
    s = score_metrics({**HEALTHY_METRICS, "cer": 0.0, "per": 0.6})
    assert s.components["intelligibility"] == 0.0 and s.components["articulation"] == 1.0


def test_each_feature_is_monotone_in_its_component():
    def sev(**over):
        return score_metrics({**HEALTHY_METRICS, **over}).severity

    for key, good, bad in (("articulation_rate", 4.6, 1.8), ("longest_pause_s", 0.1, 1.5), ("pause_ratio", 0.05, 0.6),
                           ("f0_sd_semitones", 3.0, 0.2), ("jitter_rap", 0.003, 0.04), ("shimmer_apq3", 0.02, 0.09),
                           ("cer", 0.0, 0.6), ("per", 0.0, 0.7)):
        vals = np.linspace(good, bad, 7)
        scores = [sev(**{key: float(v)}) for v in vals]
        assert scores == sorted(scores), key
        assert scores[-1] > scores[0], key


def test_score_metrics_handles_empty_and_nonfinite():
    assert score_metrics({}).severity == 0.0
    s = score_metrics({"articulation_rate": float("nan")})
    assert 0 <= s.severity <= 1


def test_config_weights_and_ramps_are_sane():
    assert C.MIN_CONFIDENCE == 0.3
    assert set(C.WEIGHTS) == {"intelligibility", "articulation", "rate", "pausing", "prosody", "voice_quality"}
    assert all(w > 0 for w in C.WEIGHTS.values())
    for lo, hi in C.RAMPS.values():
        assert lo != hi
    assert ramp(C.RAMPS["articulation_rate"][0], *C.RAMPS["articulation_rate"]) == 0.0


# ---------------------------------------------------------------- confidence
def test_confidence_rises_with_evidence_and_falls_with_poor_quality():
    base, _ = compute_confidence(30, 3.0, 0.6, False, False)
    one, _ = compute_confidence(30, 3.0, 0.6, True, False)
    both, _ = compute_confidence(30, 3.0, 0.6, True, True)
    assert base <= 0.6 < one <= 0.85 < both <= 1.0
    assert compute_confidence(12, 3.0, 0.6, False, False)[0] < base
    assert compute_confidence(30, 0.9, 0.6, False, False)[0] < base
    conf, weakest = compute_confidence(30, 3.0, 0.02, False, False)
    assert conf < base and weakest == "voice"


# ---------------------------------------------------------------- QC failures -> retry
def test_garbage_input_asks_for_retry_and_never_raises():
    rng = np.random.default_rng(0)
    for data in (b"", b"RIFF", b"RIFF" + b"\x00" * 60, b"hello world" * 100, rng.bytes(5000), wav("healthy")[:300]):
        assert_retry(analyze_speech(data, PHRASE))


def test_non_bytes_and_odd_arguments_do_not_raise():
    for data in (None, 123, "text"):
        r = analyze_speech(data, PHRASE)  # type: ignore[arg-type]
        assert_retry(r)
    assert isinstance(analyze_speech(wav("healthy"), ""), SpeechResult)


def test_too_short_recording():
    x = healthy().samples[: int(1.0 * SR)]
    r = analyze_speech(to_wav_bytes(x), PHRASE)
    assert_retry(r)
    assert "too short" in r.flags[0]


def test_silence_is_too_quiet():
    r = analyze_speech(to_wav_bytes(np.zeros(3 * SR, dtype=np.float32)), PHRASE)
    assert_retry(r)
    assert "too quiet" in r.flags[0]


def test_very_quiet_speech_is_too_quiet():
    r = analyze_speech(synth_speech(level_dbfs=-58.0, snr_db=200, seed=1).wav(), PHRASE)
    assert_retry(r)
    assert "too quiet" in r.flags[0]


def test_noisy_recording_is_rejected_with_noise_hint():
    r = analyze_speech(synth_speech(snr_db=3.0, seed=1).wav(), PHRASE)
    assert_retry(r)
    assert "background noise" in r.flags[0]


def test_white_noise_only_is_rejected():
    x = (np.random.default_rng(1).standard_normal(3 * SR) * 0.1).astype(np.float32)
    assert_retry(analyze_speech(to_wav_bytes(x), PHRASE))


def test_clipped_recording_is_rejected():
    x = np.clip(healthy().samples * 30, -1, 1).astype(np.float32)
    r = analyze_speech(to_wav_bytes(x), PHRASE)
    assert_retry(r)
    assert "too loud" in r.flags[0]


def test_one_short_blip_is_not_enough_speech():
    x = np.zeros(4 * SR, dtype=np.float32)
    x[SR : SR + int(0.3 * SR)] = healthy().samples[SR : SR + int(0.3 * SR)]
    assert_retry(analyze_speech(to_wav_bytes(x), PHRASE))


def test_whisper_does_not_crash_and_is_never_a_confident_impairment():
    r = analyze_speech(synth_speech(voiced=False, seed=1).wav(), PHRASE)
    check_valid(r)
    assert r.needs_retry or r.confidence < 0.6  # acoustic-only, no pitch: low confidence or retry


def test_other_sample_rates_and_channels_are_accepted():
    import io

    import soundfile as sf
    from scipy.signal import resample_poly

    x = healthy().samples
    x8 = resample_poly(x, 1, 2).astype(np.float32)
    buf = io.BytesIO()
    sf.write(buf, np.stack([x8, x8], axis=1), 8000, format="WAV", subtype="PCM_16")
    r = analyze_speech(buf.getvalue(), PHRASE)
    check_valid(r)
    assert not r.needs_retry and r.severity <= 0.25


def test_result_serializes_camel_case_through_the_endpoint():
    client = TestClient(app)
    body = client.post("/api/speech/analyze", files={"audio": ("a.wav", wav("healthy"), "audio/wav")}).json()
    assert body["test"] == "speech" and body["needsRetry"] is False and "startedAt" in body and "durationMs" in body


# ---------------------------------------------------------------- transcriber integration (fakes)
def words_for(text: str, start: float = 0.5, per_word: float = 0.3, conf: float | None = 0.95) -> list[Word]:
    out, t = [], start
    for w in text.split():
        out.append(Word(w, t, t + per_word, conf))
        t += per_word + 0.05
    return out


def test_perfect_transcript_adds_cer_zero_and_raises_confidence():
    base = run("healthy")
    fake = lambda b: Transcript("You can't teach an old dog new tricks.", words_for("you cant teach an old dog new tricks"))  # noqa: E731
    r = analyze_speech(wav("healthy"), PHRASE, transcriber=fake)
    assert r.metrics["cer"] == 0.0 and r.metrics["wer"] == 0.0 and r.metrics["text_match"] == 1.0
    assert r.metrics["transcript_confidence"] == pytest.approx(0.95)
    assert r.transcript == "You can't teach an old dog new tricks."
    assert r.confidence > base.confidence and r.confidence <= 0.85
    assert r.severity <= 0.15
    # word timing drives speech_rate_wps: 8 words over (0.5 .. 0.5+8*0.35-0.05)
    assert r.metrics["speech_rate_wps"] == pytest.approx(8 / (8 * 0.35 - 0.05), rel=1e-3)


def test_bad_transcript_raises_severity_and_flags_mismatch():
    fake = lambda b: Transcript("you can teach old dogs", [])  # noqa: E731
    r = analyze_speech(wav("healthy"), PHRASE, transcriber=fake)
    assert r.metrics["cer"] > 0.3
    assert r.severity > run("healthy").severity + 0.15
    assert any(f.startswith("transcript mismatch (CER ") for f in r.flags)


def test_transcript_makes_a_clear_impairment_even_more_certain():
    fake = lambda b: Transcript("ou ca tea a o do ne tri", [])  # noqa: E731
    r = analyze_speech(wav("impaired"), PHRASE, transcriber=fake)
    assert r.severity >= 0.85 and any("transcript mismatch" in f for f in r.flags)


def test_empty_transcript_counts_as_unintelligible_with_flag():
    r = analyze_speech(wav("healthy"), PHRASE, transcriber=lambda b: Transcript("", []))
    assert r.metrics["cer"] == 1.0 and "no words recognised" in r.flags


def test_transcriber_returning_none_degrades_to_acoustic_only():
    base = run("healthy")
    r = analyze_speech(wav("healthy"), PHRASE, transcriber=lambda b: None)
    assert "cer" not in r.metrics and r.transcript is None
    assert r.severity == base.severity and r.confidence == base.confidence
    assert "transcript unavailable" in r.flags


def test_transcriber_raising_degrades_to_acoustic_only():
    def boom(b: bytes):
        raise RuntimeError("api down")

    r = analyze_speech(wav("impaired"), PHRASE, transcriber=boom)
    check_valid(r)
    assert not r.needs_retry and r.severity >= 0.85 and "transcript unavailable" in r.flags


def test_slow_transcriber_times_out_and_result_is_acoustic_only(monkeypatch):
    monkeypatch.setattr(C, "TRANSCRIBE_TIMEOUT_S", 0.3)

    def slow(b: bytes):
        time.sleep(2.0)
        return Transcript("x", [])

    t0 = time.perf_counter()
    r = analyze_speech(wav("healthy"), PHRASE, transcriber=slow)
    assert time.perf_counter() - t0 < 1.5
    assert "transcript timed out" in r.flags and "cer" not in r.metrics and not r.needs_retry


def test_transcriber_is_not_called_when_qc_fails():
    calls = []
    r = analyze_speech(b"RIFF", PHRASE, transcriber=lambda b: calls.append(1))
    assert r.needs_retry and calls == []


def test_transcriber_receives_the_original_wav_bytes():
    seen = []
    analyze_speech(wav("healthy"), PHRASE, transcriber=lambda b: seen.append(b) or None)
    assert seen == [wav("healthy")]


# ---------------------------------------------------------------- phoneme integration (fake models.phoneme)
def install_fake_phoneme(monkeypatch, result=None, raises: Exception | None = None):
    calls = []
    mod = types.ModuleType("models.phoneme")

    def score_phonemes(samples, sr, phrase):
        calls.append((len(samples), sr, phrase))
        if raises:
            raise raises
        return result

    mod.score_phonemes = score_phonemes
    monkeypatch.setitem(sys.modules, "models.phoneme", mod)
    monkeypatch.setattr(models, "phoneme", mod, raising=False)
    return calls


def phoneme_result(per: float, gop_mean: float, bad=("ah", "s")):
    return SimpleNamespace(per=per, gop_mean=gop_mean, gop_min=gop_mean - 1.0, n_bad_phones=len(bad), bad_phones=list(bad), decoded="x", target="y")


def test_phoneme_scores_add_metrics_component_and_raise_confidence(monkeypatch):
    base = run("healthy")
    calls = install_fake_phoneme(monkeypatch, phoneme_result(0.05, -0.3, bad=()))
    r = run("healthy")
    assert calls and calls[0][1] == 16000 and calls[0][2] == PHRASE
    for k in ("per", "gop_mean", "gop_min", "n_bad_phones"):
        assert k in r.metrics
    assert r.metrics["per"] == pytest.approx(0.05)
    assert r.confidence > base.confidence and r.severity <= 0.15


def test_bad_phoneme_scores_raise_severity_and_name_the_phones(monkeypatch):
    base = run("healthy")
    install_fake_phoneme(monkeypatch, phoneme_result(0.8, -5.0, bad=("ah", "s", "t", "k")))
    r = run("healthy")
    assert r.severity > base.severity + 0.3
    assert "unclear sounds (ah, s, t)" in r.flags


def test_phoneme_none_or_error_or_missing_module_is_ignored(monkeypatch):
    base = run("borderline")
    install_fake_phoneme(monkeypatch, None)
    assert run("borderline").severity == base.severity
    install_fake_phoneme(monkeypatch, raises=RuntimeError("no torch"))
    r = run("borderline")
    assert r.severity == base.severity and "per" not in r.metrics
    monkeypatch.delattr(models, "phoneme", raising=False)
    monkeypatch.setitem(sys.modules, "models.phoneme", None)  # makes `from models import phoneme` raise ImportError
    r = run("borderline")
    assert r.severity == base.severity and "per" not in r.metrics and not r.needs_retry


def test_malformed_phoneme_result_is_ignored(monkeypatch):
    install_fake_phoneme(monkeypatch, SimpleNamespace(per=float("nan"), gop_mean=-1.0, gop_min=-2.0, n_bad_phones=1, bad_phones=[]))
    r = run("healthy")
    assert "per" not in r.metrics and all(math.isfinite(v) for v in r.metrics.values())
    install_fake_phoneme(monkeypatch, SimpleNamespace(per=0.1))  # missing attributes
    assert "per" not in run("healthy").metrics


def test_transcript_and_phoneme_together_reach_full_confidence_ceiling(monkeypatch):
    install_fake_phoneme(monkeypatch, phoneme_result(0.03, -0.2, bad=()))
    fake = lambda b: Transcript(PHRASE, [])  # noqa: E731
    r = analyze_speech(wav("healthy"), PHRASE, transcriber=fake)
    assert 0.85 < r.confidence <= 1.0
    assert r.severity <= 0.15
    assert set(score_metrics(r.metrics).components) == set(C.WEIGHTS)


# ---------------------------------------------------------------- timing
def test_six_second_clip_analyses_well_inside_the_endpoint_budget():
    data = synth_speech(syllable_rate=4.0, n_syllables=8, lead_s=0.6, trail_s=1.2, seed=1).wav()
    t0 = time.perf_counter()
    r = analyze_speech(data, PHRASE)
    assert time.perf_counter() - t0 < 5.0  # budget is 10 s for the whole endpoint
    assert r.duration_ms < 5000
