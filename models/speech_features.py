"""Pure feature-extraction functions for the speech test (docs/spec/03-speech.md).

Everything here maps arrays / strings to numbers: no network, no globals beyond constants from `models.config`.
All thresholds are UNCALIBRATED and have only been exercised on synthetic audio.
"""
from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass, field
from math import gcd

import numpy as np
import soundfile as sf
from rapidfuzz import fuzz
from rapidfuzz.distance import Levenshtein
from scipy.signal import find_peaks, resample_poly

from models import config as C


# ----------------------------------------------------------------------------------------------------------
# Small helpers
# ----------------------------------------------------------------------------------------------------------
def ramp(x: float, lo: float, hi: float) -> float:
    """Linear map to [0, 1]: 0 at `lo`, 1 at `hi`, clamped. Works when hi < lo (then low x is the bad side)."""
    if not math.isfinite(x):
        return 0.0
    if hi == lo:
        return 0.0
    return float(min(1.0, max(0.0, (x - lo) / (hi - lo))))


# ----------------------------------------------------------------------------------------------------------
# Loading and QC primitives
# ----------------------------------------------------------------------------------------------------------
def load_wav(wav_bytes: bytes, target_sr: int = C.SAMPLE_RATE, max_s: float = C.MAX_ANALYSIS_S) -> tuple[np.ndarray | None, str | None]:
    """Decode audio bytes to float32 mono at `target_sr`. Returns (samples, None) or (None, error).

    Expects 16 kHz mono PCM16 WAV but accepts anything libsndfile can read (other rates / channel counts /
    bit depths, FLAC, OGG); downmixes and resamples. Never raises.
    """
    if not wav_bytes or len(wav_bytes) < 44:
        return None, "empty or truncated recording"
    try:
        with sf.SoundFile(io.BytesIO(wav_bytes)) as fh:
            # Refuse absurd lengths from the header BEFORE decoding (a 5 MB 8-bit/8 kHz file is ~10 minutes of audio).
            if fh.samplerate > 0 and fh.frames / fh.samplerate > C.MAX_ACCEPT_S:
                return None, "recording too long"
            data = fh.read(dtype="float32", always_2d=True)
            sr = fh.samplerate
    except Exception as exc:  # noqa: BLE001 - any decode failure means "not usable audio"
        return None, f"could not decode audio ({type(exc).__name__})"
    if data.size == 0 or sr <= 0:
        return None, "empty recording"
    mono = data.mean(axis=1) if data.shape[1] > 1 else data[:, 0]
    mono = np.nan_to_num(mono, nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)
    if sr != target_sr:
        g = gcd(int(sr), int(target_sr))
        mono = resample_poly(mono, target_sr // g, int(sr) // g).astype(np.float32)
    mono = mono[: int(max_s * target_sr)]
    return mono, None


def clipped_fraction(samples: np.ndarray, level: float = C.CLIP_LEVEL) -> float:
    if samples.size == 0:
        return 0.0
    return float(np.mean(np.abs(samples) >= level))


def frame_power(samples: np.ndarray, sr: int, frame_s: float = C.FRAME_S, hop_s: float = C.HOP_S) -> np.ndarray:
    """Mean-square power per frame (linear, full-scale 1.0 = 1.0)."""
    n, hop = int(round(frame_s * sr)), int(round(hop_s * sr))
    if samples.size < n:
        return np.array([float(np.mean(samples.astype(np.float64) ** 2))]) if samples.size else np.zeros(1)
    win = np.lib.stride_tricks.sliding_window_view(samples.astype(np.float64), n)[::hop]
    return np.mean(win**2, axis=1)


# ----------------------------------------------------------------------------------------------------------
# Energy VAD -> segments, SNR
# ----------------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class VadResult:
    hop_s: float
    db: np.ndarray  # per-frame level, dBFS
    noise_db: float  # dBFS, quietest-20% frames (floored)
    loud_db: float  # dBFS, 95th percentile frame level
    threshold_db: float  # dBFS speech threshold
    snr_db: float  # dB, speech frames vs quietest 20%
    segments: list[tuple[float, float]] = field(default_factory=list)  # speech (start_s, end_s), pauses < MIN_PAUSE_S merged


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Inclusive (start, end) index pairs of True runs."""
    if not mask.any():
        return []
    padded = np.concatenate(([False], mask, [False]))
    edges = np.flatnonzero(padded[1:] != padded[:-1])
    return [(int(a), int(b) - 1) for a, b in zip(edges[::2], edges[1::2], strict=True)]


def energy_vad(samples: np.ndarray, sr: int) -> VadResult:
    """Adaptive energy VAD. Threshold sits between the noise floor and the loud level (in dB)."""
    power = frame_power(samples, sr)
    db = 10.0 * np.log10(power + 1e-12)
    order = np.argsort(power)
    n_quiet = max(1, int(round(0.2 * power.size)))
    noise_pow = float(np.mean(power[order[:n_quiet]]))
    floor_pow = 10.0 ** (C.VAD_NOISE_FLOOR_MIN_DB / 10.0)
    noise_pow_eff = max(noise_pow, floor_pow)
    noise_db = 10.0 * math.log10(noise_pow_eff)
    loud_db = float(np.percentile(db, 95))
    thr = noise_db + max(C.VAD_MIN_MARGIN_DB, C.VAD_MARGIN_FRACTION * (loud_db - noise_db))
    mask = db > thr
    speech_pow = float(np.mean(power[mask])) if mask.any() else float(np.mean(power[order[-n_quiet:]]))
    snr = float(np.clip(10.0 * math.log10((speech_pow + 1e-12) / noise_pow_eff), 0.0, 60.0))

    hop = C.HOP_S
    half_hop, half_frame = hop / 2.0, C.FRAME_S / 2.0
    runs = [
        (a, b) for a, b in _runs(mask) if ((b - a + 1) * hop) >= C.MIN_SEGMENT_S
    ]
    segs: list[list[float]] = []
    for a, b in runs:
        s, e = a * hop + half_frame - half_hop, b * hop + half_frame + half_hop
        if segs and s - segs[-1][1] < C.MIN_PAUSE_S:
            segs[-1][1] = e
        else:
            segs.append([s, e])
    total = samples.size / sr
    segments = [(max(0.0, s), min(total, e)) for s, e in segs]
    return VadResult(hop_s=hop, db=db, noise_db=noise_db, loud_db=loud_db, threshold_db=float(thr), snr_db=snr, segments=segments)


def trim_bounds(vad: VadResult, total_s: float, pad_s: float = C.TRIM_PAD_S) -> tuple[float, float]:
    """(start_s, end_s) of the utterance plus a little context; whole clip if there is no speech."""
    if not vad.segments:
        return 0.0, total_s
    return max(0.0, vad.segments[0][0] - pad_s), min(total_s, vad.segments[-1][1] + pad_s)


# ----------------------------------------------------------------------------------------------------------
# Temporal features (transcript-free)
# ----------------------------------------------------------------------------------------------------------
def pause_features(segments: list[tuple[float, float]]) -> dict[str, float]:
    """Pause statistics inside the utterance (first speech to last speech). Empty dict without speech."""
    if not segments:
        return {}
    utterance = segments[-1][1] - segments[0][0]
    pauses = [segments[i + 1][0] - segments[i][1] for i in range(len(segments) - 1)]
    pause_total = float(sum(pauses))
    return {
        "utterance_s": float(utterance),
        "speaking_time_s": float(max(utterance - pause_total, 1e-3)),
        "pause_total_s": pause_total,
        "pause_ratio": float(pause_total / utterance) if utterance > 0 else 0.0,
        "longest_pause_s": float(max(pauses)) if pauses else 0.0,
        "n_pauses": float(len(pauses)),
        "n_long_pauses": float(sum(p > C.LONG_PAUSE_S for p in pauses)),
    }


def syllable_nuclei(samples: np.ndarray, sr: int) -> list[float]:
    """Syllable-nucleus times (s): voiced peaks in the intensity contour (de Jong & Wempe 2009, via Praat).

    Peaks must reach within NUCLEUS_PEAK_BELOW_MAX_DB of the loudest part, be separated by a dip of at least
    NUCLEUS_MIN_DIP_DB, and fall on a voiced frame. Returns [] on any failure.
    """
    try:
        import parselmouth

        snd = parselmouth.Sound(samples.astype(np.float64), sampling_frequency=float(sr))
        inten = snd.to_intensity(minimum_pitch=C.NUCLEUS_MIN_PITCH_HZ, time_step=C.HOP_S)
        db = np.nan_to_num(inten.values[0], nan=0.0, posinf=0.0, neginf=0.0)
        times = inten.xs()
        peaks, _ = find_peaks(db, prominence=C.NUCLEUS_MIN_DIP_DB)
        floor = float(np.percentile(db, 99)) - C.NUCLEUS_PEAK_BELOW_MAX_DB
        peaks = [p for p in peaks if db[p] >= floor]
        pitch = snd.to_pitch(time_step=C.PITCH_TIME_STEP_S, pitch_floor=C.PITCH_FLOOR_HZ, pitch_ceiling=C.PITCH_CEILING_HZ)
        out: list[float] = []
        for p in peaks:
            f0 = pitch.get_value_at_time(float(times[p]))
            if f0 is not None and math.isfinite(f0) and f0 > 0:
                out.append(float(times[p]))
        return out
    except Exception:  # noqa: BLE001
        return []


def rhythm_cv(nucleus_times: list[float]) -> float | None:
    """Coefficient of variation of inter-syllable intervals; None if fewer than 3 intervals."""
    if len(nucleus_times) < 4:
        return None
    d = np.diff(np.asarray(nucleus_times))
    m = float(np.mean(d))
    return float(np.std(d) / m) if m > 0 else None


def count_syllables(phrase: str) -> int:
    """Syllables in `phrase`: hardcoded table for the rotation phrases, vowel-group heuristic otherwise."""
    norm = normalize_text(phrase)
    if norm in C.PHRASE_SYLLABLES:
        return C.PHRASE_SYLLABLES[norm]
    total = 0
    for w in norm.split():
        groups = len(re.findall(r"[aeiouy]+", w))
        if w.endswith("e") and not w.endswith(("le", "ee")) and groups > 1:
            groups -= 1
        total += max(1, groups)
    return total


def choose_syllable_count(n_target: int, n_nuclei: int) -> int:
    """Trust the target phrase's syllable count unless the nuclei disagree wildly (then say what was heard)."""
    if n_target > 0:
        lo, hi = C.NUCLEUS_RATIO_OK
        if n_nuclei == 0 or lo <= n_nuclei / n_target <= hi:
            return n_target
    return max(1, n_nuclei) if n_nuclei > 0 else max(1, n_target)


# ----------------------------------------------------------------------------------------------------------
# Acoustic features (Praat)
# ----------------------------------------------------------------------------------------------------------
def acoustic_features(samples: np.ndarray, sr: int) -> tuple[dict[str, float], list[str]]:
    """Prosody and voice-quality metrics from Praat over voiced frames. Returns (metrics, flags).

    Omits any metric it cannot measure (whisper, no voiced frames, tracking failure) and never raises.
    `voiced_fraction` (voiced frames / all frames of `samples`) is always present when Praat ran.
    """
    metrics: dict[str, float] = {}
    flags: list[str] = []
    try:
        import parselmouth
        from parselmouth.praat import call

        snd = parselmouth.Sound(samples.astype(np.float64), sampling_frequency=float(sr))
        pitch = snd.to_pitch(time_step=C.PITCH_TIME_STEP_S, pitch_floor=C.PITCH_FLOOR_HZ, pitch_ceiling=C.PITCH_CEILING_HZ)
    except Exception:  # noqa: BLE001
        return {"voiced_fraction": 0.0}, ["couldn't track pitch"]

    f0 = np.asarray(pitch.selected_array["frequency"], dtype=np.float64)
    p_times = np.asarray(pitch.xs(), dtype=np.float64)
    voiced = np.isfinite(f0) & (f0 > 0)
    metrics["voiced_fraction"] = float(np.mean(voiced)) if voiced.size else 0.0
    if int(voiced.sum()) < C.MIN_VOICED_FRAMES:
        return metrics, ["couldn't detect voice pitch"]

    # Pitch variation in semitones around the speaker's own median; octave-error outliers are dropped.
    st = 12.0 * np.log2(f0[voiced] / float(np.median(f0[voiced])))
    st = st[np.abs(st) <= C.F0_OUTLIER_SEMITONES]
    if st.size >= C.MIN_VOICED_FRAMES:
        metrics["f0_sd_semitones"] = float(np.std(st))
        metrics["f0_range_semitones"] = float(np.percentile(st, 95) - np.percentile(st, 5))
        metrics["f0_median_hz"] = float(np.median(f0[voiced]))

    try:
        inten = snd.to_intensity(minimum_pitch=C.PITCH_FLOOR_HZ, time_step=C.PITCH_TIME_STEP_S)
        i_db = np.nan_to_num(inten.values[0], nan=0.0)
        at_voiced = np.interp(p_times[voiced], inten.xs(), i_db)
        metrics["intensity_sd_db"] = float(np.std(at_voiced))
    except Exception:  # noqa: BLE001
        flags.append("couldn't measure loudness")

    if int(voiced.sum()) >= C.JITTER_MIN_VOICED_FRAMES:
        try:
            pp = call([snd, pitch], "To PointProcess (cc)")
            for name, cmd, args in (
                ("jitter_local", "Get jitter (local)", (0, 0, 0.0001, 0.02, 1.3)),
                ("jitter_rap", "Get jitter (rap)", (0, 0, 0.0001, 0.02, 1.3)),
            ):
                v = float(call(pp, cmd, *args))
                if math.isfinite(v):
                    metrics[name] = v
            for name, cmd in (("shimmer_local", "Get shimmer (local)"), ("shimmer_apq3", "Get shimmer (apq3)")):
                v = float(call([snd, pp], cmd, 0, 0, 0.0001, 0.02, 1.3, 1.6))
                if math.isfinite(v):
                    metrics[name] = v
        except Exception:  # noqa: BLE001
            pass
        try:
            hnr = snd.to_harmonicity_cc(time_step=C.PITCH_TIME_STEP_S, minimum_pitch=C.PITCH_FLOOR_HZ)
            vals = np.asarray(hnr.values[0], dtype=np.float64)
            vals = vals[np.isfinite(vals) & (vals > -100.0)]
            if vals.size >= C.MIN_VOICED_FRAMES:
                metrics["hnr_db"] = float(np.mean(vals))
        except Exception:  # noqa: BLE001
            pass
    if not {"jitter_rap", "shimmer_apq3", "hnr_db"} & metrics.keys():
        flags.append("couldn't measure voice quality")
    return metrics, flags


# ----------------------------------------------------------------------------------------------------------
# Text metrics (transcript vs target)
# ----------------------------------------------------------------------------------------------------------
def normalize_text(text: str) -> str:
    """Lowercase, drop apostrophes ("can't" -> "cant"), turn other punctuation into spaces, collapse whitespace."""
    t = text.lower().replace("'", "").replace("’", "")
    t = re.sub(r"[^\w\s]|_", " ", t)
    return " ".join(t.split())


def _error_rate(ref: str | list[str], hyp: str | list[str]) -> float:
    if len(ref) == 0:
        return 0.0 if len(hyp) == 0 else 1.0
    return float(min(1.0, Levenshtein.distance(ref, hyp) / len(ref)))


def char_error_rate(target: str, hypothesis: str) -> float:
    """Character error rate (Levenshtein / target length) on normalized text, capped at 1."""
    return _error_rate(normalize_text(target), normalize_text(hypothesis))


def word_error_rate(target: str, hypothesis: str) -> float:
    """Word error rate on normalized text, capped at 1."""
    return _error_rate(normalize_text(target).split(), normalize_text(hypothesis).split())


def text_match(target: str, hypothesis: str) -> float:
    """Fuzzy similarity 0..1 on normalized text (rapidfuzz ratio)."""
    return float(fuzz.ratio(normalize_text(target), normalize_text(hypothesis)) / 100.0)
