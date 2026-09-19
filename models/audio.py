"""Speech analysis orchestrator (docs/spec/03-speech.md): QC -> features -> weighted severity -> TestResult.

Entry point: `analyze_speech(wav_bytes, target_phrase, transcriber=None) -> TestResult`. It never raises: any
problem becomes a `needs_retry` result whose `flags[0]` is a short spoken-style reason.

Optional evidence, each of which only ADDS components (weights are renormalized over what is available):
- a transcript from a pluggable `Transcriber` (models/transcribe.py) -> CER / WER / word timing
- phoneme scores from `models.phoneme.score_phonemes` (agent B, needs torch) -> PER / GOP

Thresholds and weights live in models/config.py and are UNCALIBRATED.
"""
from __future__ import annotations

import logging
import math
import time
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass, field

import numpy as np

from backend.schemas import TestResult
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
from models.transcribe import Transcript, Transcriber

log = logging.getLogger("speech")

__all__ = ["analyze_speech", "score_metrics", "compute_confidence", "Score", "ramp"]


# ----------------------------------------------------------------------------------------------------------
# Scoring (pure)
# ----------------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Score:
    severity: float  # 0..1, after SEVERITY_MAP
    weighted_sum: float  # 0..1, renormalized weighted mean of the components
    components: dict[str, float] = field(default_factory=dict)  # component -> 0..1
    weights: dict[str, float] = field(default_factory=dict)  # renormalized weights actually used (sum to 1)


def _mean(vals: list[float]) -> float:
    return float(sum(vals) / len(vals))


def component_scores(m: Mapping[str, float]) -> dict[str, float]:
    """Each available component as 0..1 (0 = normal, 1 = clearly abnormal). Missing inputs -> component omitted."""
    R = C.RAMPS
    out: dict[str, float] = {}
    if "cer" in m:  # intelligibility comes ONLY from a real transcript (PER is scored once, in articulation, below)
        out["intelligibility"] = ramp(m["cer"], *R["cer"])
    art = []
    if "per" in m:
        art.append(ramp(m["per"], *R["per"]))
    if "gop_mean" in m:
        art.append(ramp(m["gop_mean"], *R["gop_mean"]))
    if art:
        out["articulation"] = _mean(art)
    if "articulation_rate" in m:
        out["rate"] = ramp(m["articulation_rate"], *R["articulation_rate"])
    pause = [ramp(m[k], *R[k]) for k in ("longest_pause_s", "pause_ratio") if k in m]
    if pause:
        out["pausing"] = _mean(pause)
    if "f0_sd_semitones" in m:
        out["prosody"] = ramp(m["f0_sd_semitones"], *R["f0_sd_semitones"])
    # HNR is useful to report, but consonants and natural unvoiced intervals make whole-utterance HNR too low for
    # sustained-vowel clinical thresholds. It false-alarmed on the first clean real-mic fixed-phrase recording.
    vq = [ramp(m[k], *R[k]) for k in ("jitter_rap", "shimmer_apq3") if k in m]
    if vq:
        out["voice_quality"] = _mean(vq)
    return out


def score_metrics(metrics: Mapping[str, float]) -> Score:
    """metrics -> components -> weights renormalized over the available ones -> severity 0..1."""
    comps = component_scores(metrics)
    total_w = sum(C.WEIGHTS[k] for k in comps)
    if not comps or total_w <= 0:
        return Score(0.0, 0.0)
    weights = {k: C.WEIGHTS[k] / total_w for k in comps}
    wsum = float(sum(weights[k] * comps[k] for k in comps))
    return Score(severity=ramp(wsum, *C.SEVERITY_MAP), weighted_sum=wsum, components=comps, weights=weights)


def compute_confidence(snr_db: float, speech_s: float, voiced_fraction: float, has_transcript: bool, has_phoneme: bool) -> tuple[float, str]:
    """Confidence 0..1 and the name of the weakest quality term ('snr' | 'duration' | 'voice')."""
    fl = C.CONFIDENCE_QUALITY_FLOOR
    terms = {
        "snr": fl + (1 - fl) * ramp(snr_db, *C.CONFIDENCE_SNR_DB),
        "duration": fl + (1 - fl) * ramp(speech_s, *C.CONFIDENCE_SPEECH_S),
        "voice": fl + (1 - fl) * ramp(voiced_fraction, *C.CONFIDENCE_VOICED_FRACTION),
    }
    quality = float(np.prod(list(terms.values())) ** (1.0 / len(terms)))
    n_extra = int(has_transcript) + int(has_phoneme)
    ceiling = (C.CONFIDENCE_CEILING["acoustic"], C.CONFIDENCE_CEILING["one_extra"], C.CONFIDENCE_CEILING["both_extra"])[n_extra]
    return float(min(1.0, max(0.0, ceiling * quality))), min(terms, key=terms.get)


def _flags_for(components: Mapping[str, float], metrics: Mapping[str, float], bad_phones: list[str]) -> list[str]:
    t = C.FLAG_MIN_COMPONENT
    flags: list[str] = []
    if components.get("intelligibility", 0) >= t and "cer" in metrics:
        flags.append(f"transcript mismatch (CER {metrics['cer']:.2f})")
    if components.get("articulation", 0) >= t:
        flags.append(f"unclear sounds ({', '.join(bad_phones[:3])})" if bad_phones else "unclear sounds")
    if components.get("rate", 0) >= 0.6:
        flags.append("very slow articulation")
    elif components.get("rate", 0) >= t:
        flags.append("slow articulation")
    if components.get("pausing", 0) >= t:
        flags.append("long pauses")
    if components.get("prosody", 0) >= 0.6:
        flags.append("flat pitch")
    if components.get("voice_quality", 0) >= t:
        flags.append("rough or breathy voice")
    return flags


# ----------------------------------------------------------------------------------------------------------
# Results
# ----------------------------------------------------------------------------------------------------------
def _finite(metrics: Mapping[str, float]) -> dict[str, float]:
    return {k: round(float(v), 4) for k, v in metrics.items() if v is not None and math.isfinite(float(v))}


def _retry(reason: str, started_at: int, t0: float, metrics: Mapping[str, float] | None = None, confidence: float | None = None) -> TestResult:
    conf = C.RETRY_CONFIDENCE if confidence is None else min(confidence, C.RETRY_CONFIDENCE)
    return TestResult(
        test="speech",
        severity=0.0,
        confidence=max(0.0, conf),
        metrics=_finite(metrics or {}),
        flags=[reason],
        started_at=started_at,
        duration_ms=int((time.perf_counter() - t0) * 1000),
        needs_retry=True,
    )


_RETRY_FOR_TERM = {
    "snr": "too much background noise",
    "duration": "too short, please say the whole sentence",
    "voice": "couldn't pick up your voice clearly, please speak up",
}


# ----------------------------------------------------------------------------------------------------------
# Optional evidence
# ----------------------------------------------------------------------------------------------------------
def _phoneme_scores(samples: np.ndarray, target_phrase: str):
    """Agent B's wav2vec2 scorer, or None if the module/torch is missing or it declines. Never raises."""
    try:
        from models import phoneme  # lazy: may not exist, and importing it may pull torch

        return phoneme.score_phonemes(samples, C.SAMPLE_RATE, target_phrase)
    except Exception as exc:  # noqa: BLE001 - ImportError, missing torch, model load, inference errors
        log.debug("phoneme scoring unavailable: %s", type(exc).__name__)
        return None


def _transcript_metrics(target: str, tr: Transcript) -> tuple[dict[str, float], list[str]]:
    m: dict[str, float] = {
        "cer": char_error_rate(target, tr.text),
        "wer": word_error_rate(target, tr.text),
        "text_match": text_match(target, tr.text),
    }
    flags: list[str] = []
    if not normalize_text(tr.text):
        flags.append("no words recognised")
    confs = [w.confidence for w in tr.words if w.confidence is not None and math.isfinite(w.confidence)]
    if confs:
        m["transcript_confidence"] = _mean(confs)
    return m, flags


# ----------------------------------------------------------------------------------------------------------
# Orchestrator
# ----------------------------------------------------------------------------------------------------------
def analyze_speech(wav_bytes: bytes, target_phrase: str, transcriber: Transcriber | None = None) -> TestResult:
    """Analyze a recording of the patient repeating `target_phrase`. Never raises."""
    started_at = int(time.time() * 1000)
    t0 = time.perf_counter()
    try:
        return _analyze(wav_bytes, target_phrase, transcriber, started_at, t0)
    except Exception:  # noqa: BLE001
        log.exception("speech analysis failed")
        return _retry("something went wrong analysing that, please try again", started_at, t0)


def _analyze(wav_bytes: bytes, target_phrase: str, transcriber: Transcriber | None, started_at: int, t0: float) -> TestResult:
    sr = C.SAMPLE_RATE
    samples, _err = load_wav(wav_bytes, sr)
    if samples is None:
        return _retry("couldn't read that recording, please try again", started_at, t0)

    total_s = samples.size / sr
    qc: dict[str, float] = {"duration_s": total_s}
    if total_s < C.MIN_DURATION_S:
        return _retry("too short, please say the whole sentence", started_at, t0, qc)

    vad = energy_vad(samples, sr)
    qc["snr_db"] = vad.snr_db
    qc["speech_level_dbfs"] = vad.loud_db
    if vad.loud_db < C.MIN_SPEECH_DBFS:
        return _retry("too quiet, please speak louder", started_at, t0, qc)
    clip = clipped_fraction(samples)
    qc["clipped_fraction"] = clip
    if clip >= C.MAX_CLIPPED_FRACTION:
        return _retry("too loud, please move back from the microphone", started_at, t0, qc)
    if vad.snr_db < C.MIN_SNR_DB:
        return _retry("too much background noise", started_at, t0, qc)
    temporal = pause_features(vad.segments)
    if not temporal or temporal["utterance_s"] < C.MIN_SPEECH_S:
        return _retry("couldn't hear enough speech, please say the whole sentence", started_at, t0, qc)

    # Optional transcript runs in the background while the DSP below is computed.
    pool: ThreadPoolExecutor | None = None
    future = None
    if transcriber is not None:
        pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="transcribe")
        future = pool.submit(transcriber, wav_bytes)
    t_submit = time.perf_counter()

    try:
        a, b = trim_bounds(vad, total_s)
        trimmed = samples[int(a * sr) : int(b * sr)]
        metrics: dict[str, float] = {**qc, **temporal}
        flags: list[str] = []

        # Temporal (transcript-free)
        nuclei = syllable_nuclei(trimmed, sr)
        n_syll = choose_syllable_count(count_syllables(target_phrase), len(nuclei))
        metrics["syllable_count"] = float(n_syll)
        metrics["syllable_nuclei"] = float(len(nuclei))
        metrics["articulation_rate"] = n_syll / temporal["speaking_time_s"]
        if nuclei:
            metrics["articulation_rate_nuclei"] = len(nuclei) / temporal["speaking_time_s"]
        cv = rhythm_cv(nuclei)
        if cv is not None:
            metrics["rhythm_var"] = cv

        # Acoustic (Praat)
        ac, ac_flags = acoustic_features(trimmed, sr)
        metrics.update(ac)
        flags.extend(ac_flags)

        # Phoneme scores (agent B), optional
        ph = _phoneme_scores(trimmed, target_phrase)
        bad_phones: list[str] = []
        if ph is not None:
            try:
                got = {k: float(getattr(ph, k)) for k in ("per", "gop_mean", "gop_min", "n_bad_phones")}
                if all(math.isfinite(v) for v in got.values()):
                    metrics.update(got)
                    bad_phones = [str(p) for p in getattr(ph, "bad_phones", [])]
            except Exception:  # noqa: BLE001 - malformed result object: treat as "no phoneme scores"
                pass
        has_phoneme = "per" in metrics

        # Transcript, optional
        transcript: Transcript | None = None
        if future is not None:
            try:
                remaining = max(0.05, C.TRANSCRIBE_TIMEOUT_S - (time.perf_counter() - t_submit))
                transcript = future.result(timeout=remaining)
            except FutureTimeout:
                flags.append("transcript timed out")
            except Exception as exc:  # noqa: BLE001
                log.debug("transcriber failed: %s", type(exc).__name__)
                flags.append("transcript unavailable")
            else:
                if transcript is None:
                    flags.append("transcript unavailable")
        has_transcript = transcript is not None
        n_words = len(normalize_text(target_phrase).split())
        if transcript is not None:
            tm, tflags = _transcript_metrics(target_phrase, transcript)
            metrics.update(tm)
            flags.extend(tflags)
            timed = [w for w in transcript.words if math.isfinite(w.start_s) and math.isfinite(w.end_s) and w.end_s > w.start_s]
            if transcript.words:
                n_words = len(transcript.words)
            if len(timed) >= 2:
                span = max(w.end_s for w in timed) - min(w.start_s for w in timed)
                metrics["speech_rate_wps"] = n_words / span
        metrics.setdefault("speech_rate_wps", n_words / temporal["utterance_s"])
    finally:
        if pool is not None:
            pool.shutdown(wait=False, cancel_futures=True)

    metrics = _finite(metrics)
    score = score_metrics(metrics)
    confidence, weakest = compute_confidence(
        metrics["snr_db"], metrics["utterance_s"], metrics.get("voiced_fraction", 0.0), has_transcript, has_phoneme
    )
    if confidence < C.MIN_CONFIDENCE:
        return _retry(_RETRY_FOR_TERM[weakest], started_at, t0, metrics, confidence)

    flags = _flags_for(score.components, metrics, bad_phones) + flags
    log.debug("speech severity=%.2f conf=%.2f components=%s", score.severity, confidence, score.components)
    return TestResult(
        test="speech",
        severity=round(score.severity, 4),
        confidence=round(confidence, 4),
        metrics=metrics,
        flags=flags,
        started_at=started_at,
        duration_ms=int((time.perf_counter() - t0) * 1000),
        needs_retry=False,
        transcript=transcript.text if transcript is not None else None,
    )
