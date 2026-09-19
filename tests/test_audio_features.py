"""Feature-extraction tests (models/speech_features.py) on constructed and synthetic signals.

NOTE: tests/audio_synth.py signals are synthetic speech-LIKE audio, not speech. Passing here shows the DSP
recovers known ground truth (rates, pauses, pitch variation); it does not show the features separate real
healthy from real dysarthric speakers. See docs/spec/03-speech.md (calibration) for that.
"""
import io
import math

import numpy as np
import pytest
import soundfile as sf

from models import config as C
from models.speech_features import (
    acoustic_features,
    char_error_rate,
    choose_syllable_count,
    clipped_fraction,
    count_syllables,
    energy_vad,
    load_wav,
    normalize_text,
    pause_features,
    ramp,
    rhythm_cv,
    syllable_nuclei,
    text_match,
    trim_bounds,
    word_error_rate,
)
from tests.audio_synth import SR, healthy, synth_speech, to_wav_bytes

SR_ = 16000
rng = np.random.default_rng(0)


def bursts(spans: list[tuple[float, float]], total: float, noise: float = 1e-4, sr: int = SR_) -> np.ndarray:
    """Constructed signal: harmonic bursts (voiced-like) at the given (start, end) seconds over a quiet noise floor."""
    n = int(total * sr)
    x = rng.standard_normal(n) * noise
    t = np.arange(n) / sr
    tone = sum(np.sin(2 * np.pi * 150 * k * t) / k for k in range(1, 6)) * 0.08
    for a, b in spans:
        i, j = int(a * sr), int(b * sr)
        x[i:j] += tone[i:j]
    return x.astype(np.float32)


# ---------------------------------------------------------------- ramp
def test_ramp_maps_between_normal_and_abnormal():
    assert ramp(0.1, 0.1, 0.4) == 0.0
    assert ramp(0.4, 0.1, 0.4) == 1.0
    assert ramp(0.25, 0.1, 0.4) == pytest.approx(0.5)
    assert ramp(-5, 0.1, 0.4) == 0.0 and ramp(5, 0.1, 0.4) == 1.0  # clamped


def test_ramp_works_when_bad_side_is_low():
    lo, hi = 4.0, 2.2  # articulation rate: low is bad
    assert ramp(5.0, lo, hi) == 0.0
    assert ramp(4.0, lo, hi) == 0.0
    assert ramp(3.1, lo, hi) == pytest.approx(0.5)
    assert ramp(2.2, lo, hi) == 1.0
    assert ramp(1.0, lo, hi) == 1.0


def test_ramp_degenerate_and_nonfinite_inputs_do_not_crash():
    assert ramp(1.0, 2.0, 2.0) == 0.0
    assert ramp(float("nan"), 0.0, 1.0) == 0.0
    assert ramp(float("inf"), 0.0, 1.0) == 0.0


# ---------------------------------------------------------------- loading
def test_load_wav_accepts_16k_mono_pcm16():
    s = healthy()
    x, err = load_wav(s.wav())
    assert err is None and x is not None
    assert x.dtype == np.float32 and abs(len(x) - len(s.samples)) <= 1
    assert np.allclose(x, s.samples, atol=1e-3)


def test_load_wav_downmixes_and_resamples():
    t = np.arange(int(1.0 * 44100)) / 44100
    stereo = np.stack([0.3 * np.sin(2 * np.pi * 220 * t), 0.1 * np.sin(2 * np.pi * 220 * t)], axis=1).astype(np.float32)
    buf = io.BytesIO()
    sf.write(buf, stereo, 44100, format="WAV", subtype="PCM_24")
    x, err = load_wav(buf.getvalue())
    assert err is None and x is not None
    assert abs(len(x) - 16000) <= 2
    assert 0.15 < float(np.max(np.abs(x))) < 0.25  # mean of 0.3 and 0.1


@pytest.mark.parametrize("data", [b"", b"RIFF", b"not audio at all" * 20, bytes(range(256)) * 4, b"RIFF" + b"\x00" * 100])
def test_load_wav_rejects_garbage_without_raising(data):
    x, err = load_wav(data)
    assert x is None and isinstance(err, str)


def test_load_wav_truncated_file_does_not_raise():
    data = healthy().wav()
    x, err = load_wav(data[: len(data) // 2])  # header claims more data than exists
    assert (x is None) == (err is not None)


def test_load_wav_truncates_very_long_audio():
    long = np.zeros(int(30 * SR_), dtype=np.float32)
    x, _ = load_wav(to_wav_bytes(long))
    assert x is not None and len(x) == int(C.MAX_ANALYSIS_S * SR_)


def test_clipped_fraction():
    x = np.zeros(1000, dtype=np.float32)
    x[:20] = 1.0
    assert clipped_fraction(x) == pytest.approx(0.02)
    assert clipped_fraction(np.zeros(0, dtype=np.float32)) == 0.0


# ---------------------------------------------------------------- VAD, pauses, SNR
def test_vad_finds_segments_and_pause_between_bursts():
    x = bursts([(0.5, 1.3), (1.9, 2.8)], total=3.6)
    vad = energy_vad(x, SR_)
    assert len(vad.segments) == 2
    (a0, b0), (a1, b1) = vad.segments
    assert a0 == pytest.approx(0.5, abs=0.05) and b1 == pytest.approx(2.8, abs=0.05)
    assert (a1 - b0) == pytest.approx(0.6, abs=0.06)
    pf = pause_features(vad.segments)
    assert pf["longest_pause_s"] == pytest.approx(0.6, abs=0.06)
    assert pf["n_long_pauses"] == 1
    assert pf["pause_ratio"] == pytest.approx(0.6 / 2.3, abs=0.04)
    assert pf["utterance_s"] == pytest.approx(2.3, abs=0.08)


def test_short_gaps_are_articulation_not_pauses():
    x = bursts([(0.5, 1.0), (1.1, 1.6), (1.72, 2.2)], total=3.0)  # 0.10 s and 0.12 s gaps < MIN_PAUSE_S
    pf = pause_features(energy_vad(x, SR_).segments)
    assert pf["n_pauses"] == 0 and pf["longest_pause_s"] == 0.0 and pf["pause_ratio"] == 0.0


def test_pause_between_short_and_long_threshold_counts_correctly():
    x = bursts([(0.4, 1.0), (1.3, 1.9), (2.5, 3.0)], total=3.6)  # gaps 0.3 (pause, not long) and 0.6 (long)
    pf = pause_features(energy_vad(x, SR_).segments)
    assert pf["n_pauses"] == 2 and pf["n_long_pauses"] == 1
    assert pf["longest_pause_s"] == pytest.approx(0.6, abs=0.06)


def test_pause_features_empty_without_speech():
    assert pause_features([]) == {}
    assert energy_vad(np.zeros(SR_ * 2, dtype=np.float32), SR_).segments == []


def test_trim_bounds_cover_the_utterance_with_padding():
    x = bursts([(0.8, 2.0)], total=3.5)
    a, b = trim_bounds(energy_vad(x, SR_), 3.5)
    assert 0.6 < a < 0.8 and 2.0 < b < 2.3


def test_snr_estimate_tracks_noise_level():
    clean = healthy(snr_db=40.0)
    noisy = healthy(snr_db=15.0)
    s_clean = energy_vad(clean.samples, SR).snr_db
    s_noisy = energy_vad(noisy.samples, SR).snr_db
    assert s_clean > s_noisy + 15
    assert s_noisy == pytest.approx(15.0, abs=4.0)


# ---------------------------------------------------------------- syllables / rate
@pytest.mark.parametrize("rate", [3.0, 4.5, 6.0])
def test_syllable_nuclei_count_matches_synthetic_syllables(rate):
    s = healthy(syllable_rate=rate)
    nuclei = syllable_nuclei(s.samples, SR)
    assert abs(len(nuclei) - s.n_syllables) <= 1


def test_syllable_nuclei_are_near_true_syllable_centres():
    s = healthy(syllable_rate=4.0)
    nuclei = syllable_nuclei(s.samples, SR)
    assert len(nuclei) == s.n_syllables
    assert np.max(np.abs(np.array(nuclei) - np.array(s.syllable_times))) < 0.08


def test_rhythm_cv_is_low_for_regular_and_high_for_irregular():
    regular = [0.1 * i for i in range(10)]
    irregular = [0.0, 0.1, 0.5, 0.6, 1.4, 1.5, 1.6, 2.6]
    assert rhythm_cv(regular) == pytest.approx(0.0, abs=1e-9)
    assert rhythm_cv(irregular) > 0.5
    assert rhythm_cv([0.0, 0.1]) is None


def test_count_syllables_table_and_heuristic():
    assert count_syllables("You can't teach an old dog new tricks.") == 8
    assert count_syllables("Nothing beats a jolly good breakfast") == 9
    assert count_syllables("banana") == 3  # heuristic path
    assert count_syllables("the cat sat") == 3


def test_choose_syllable_count_trusts_target_unless_nuclei_disagree_wildly():
    assert choose_syllable_count(8, 7) == 8
    assert choose_syllable_count(8, 11) == 8
    assert choose_syllable_count(8, 20) == 20  # said something much longer than the target
    assert choose_syllable_count(8, 2) == 2
    assert choose_syllable_count(8, 0) == 8  # nuclei detection failed: fall back to the target


# ---------------------------------------------------------------- acoustic features
def test_f0_sd_is_monotone_in_synthetic_pitch_variation():
    sds = [acoustic_features(synth_speech(f0_sd_st=v, jitter=0.002, seed=7).samples, SR)[0]["f0_sd_semitones"] for v in (0.0, 1.5, 3.0, 5.0)]
    assert sds == sorted(sds) and len(set(sds)) == 4
    assert sds[0] < 0.5 < sds[2]


def test_f0_range_grows_with_pitch_variation():
    flat = acoustic_features(synth_speech(f0_sd_st=0.0, seed=8).samples, SR)[0]["f0_range_semitones"]
    varied = acoustic_features(synth_speech(f0_sd_st=4.0, seed=8).samples, SR)[0]["f0_range_semitones"]
    assert varied > flat + 3


def test_voice_quality_metrics_move_the_right_way():
    good, _ = acoustic_features(synth_speech(jitter=0.002, shimmer=0.01, breathiness=0.0, seed=9).samples, SR)
    bad, _ = acoustic_features(synth_speech(jitter=0.04, shimmer=0.12, breathiness=0.5, seed=9).samples, SR)
    assert bad["jitter_rap"] > good["jitter_rap"] * 3
    assert bad["shimmer_apq3"] > good["shimmer_apq3"] * 2
    assert bad["hnr_db"] < good["hnr_db"] - 8


def test_rap_and_apq3_are_robust_to_intonation_where_local_variants_are_not():
    """Documents WHY the score uses rap/apq3: steady voice + normal intonation already inflates *local* jitter/shimmer."""
    m, _ = acoustic_features(synth_speech(f0_sd_st=3.0, jitter=0.0, shimmer=0.0, breathiness=0.0, seed=10).samples, SR)
    assert m["shimmer_local"] > 0.06 and m["shimmer_local"] > 3 * m["shimmer_apq3"]  # inflated by running-speech dynamics
    assert m["jitter_local"] > 1.5 * m["jitter_rap"]
    assert m["jitter_rap"] < 0.004 and m["shimmer_apq3"] < 0.03


def test_voiced_fraction_high_for_voiced_and_low_for_whisper():
    v, _ = acoustic_features(healthy().samples, SR)
    w, flags = acoustic_features(synth_speech(voiced=False, seed=11).samples, SR)
    assert v["voiced_fraction"] > 0.4
    assert w["voiced_fraction"] < 0.2
    assert "f0_sd_semitones" not in w and "jitter_rap" not in w  # omitted, not garbage
    assert flags and all(isinstance(f, str) for f in flags)


@pytest.mark.parametrize("x", [np.zeros(SR_, dtype=np.float32), (rng.standard_normal(SR_) * 0.1).astype(np.float32), np.zeros(10, dtype=np.float32)])
def test_acoustic_features_never_raise_on_degenerate_input(x):
    m, flags = acoustic_features(x, SR_)
    assert all(math.isfinite(v) for v in m.values())
    assert isinstance(flags, list)


# ---------------------------------------------------------------- text metrics
def test_normalize_text():
    assert normalize_text("You can't teach an old dog new tricks.") == "you cant teach an old dog new tricks"
    assert normalize_text("  Hello,   WORLD!! ") == "hello world"
    assert normalize_text("it’s") == "its"


def test_cer_known_values():
    assert char_error_rate("cat", "cut") == pytest.approx(1 / 3)
    assert char_error_rate("cat", "cat") == 0.0
    assert char_error_rate("abcd", "") == 1.0
    assert char_error_rate("abcd", "abcdefgh") == 1.0  # capped at 1
    assert char_error_rate("", "") == 0.0 and char_error_rate("", "x") == 1.0


def test_cer_ignores_case_and_punctuation():
    assert char_error_rate("You can't teach an old dog new tricks.", "you cant teach an old dog new tricks") == 0.0


def test_cer_on_mumbled_transcript():
    target = "You can't teach an old dog new tricks."
    cer = char_error_rate(target, "you cant tea an ol dog new trick")
    assert 0.05 < cer < 0.2


def test_wer_known_values():
    assert word_error_rate("the cat sat", "the cat sit") == pytest.approx(1 / 3)
    assert word_error_rate("the cat sat", "the sat") == pytest.approx(1 / 3)  # one deletion
    assert word_error_rate("the cat sat", "the big cat sat") == pytest.approx(1 / 3)  # one insertion
    assert word_error_rate("the cat sat", "") == 1.0
    assert word_error_rate("the cat sat", "The Cat, Sat!") == 0.0


def test_text_match_fuzzy_score():
    assert text_match("old dog", "old dog") == 1.0
    assert 0.5 < text_match("you cant teach an old dog", "you cant teach an old dug") < 1.0
    assert text_match("abc", "xyz") == 0.0
