"""Speech analysis orchestrator (docs/spec/03-speech.md): QC -> features -> weighted severity -> TestResult.

Entry point: `analyze_speech(wav_bytes, target_phrase, transcriber=None, lang="en") -> TestResult`. It never raises: any
problem becomes a `needs_retry` result whose `flags[0]` is a short spoken-style reason.

Optional evidence, each of which only ADDS components (weights are renormalized over what is available):
- a transcript from a pluggable `Transcriber` (models/transcribe.py) -> CER / WER / word timing
- phoneme scores from `models.phoneme.score_phonemes` (agent B, needs torch) -> PER / GOP

`lang="es"` (or any non-English value) skips the phoneme model (it is English-only), adds an honest flag and caps severity
(config.NON_ENGLISH_SEVERITY_CAP), so a Spanish recording is scored from timing and voice signals alone, conservatively.

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
from models.transcribe import Transcriber, Transcript

log = logging.getLogger("speech")

__all__ = ["analyze_speech", "score_metrics", "compute_confidence", "phoneme_trust", "severity_cap", "Score", "ramp"]


# ----------------------------------------------------------------------------------------------------------
# Scoring (pure)
# ----------------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Score:
    severity: float  # 0..1, after SEVERITY_MAP
    weighted_sum: float  # 0..1, renormalized weighted mean of the components
    components: dict[str, float] = field(default_factory=dict)  # component -> 0..1
    weights: dict[str, float] = field(default_factory=dict)  # renormalized weights actually used (sum to 1)
    uncapped_severity: float = 0.0  # severity before the agreement cap
    cap_reason: str = ""  # "", "quality-only", "timing-only" or "no-signal": which agreement rule limited the severity


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
        out["articulation"] = _mean(art) * min(1.0, max(0.0, m.get("phoneme_trust", 1.0)))
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


def phoneme_trust(snr_db: float, insertion_ratio: float | None = None) -> float:
    """0..1 multiplier on the phoneme (articulation) component: noisy rooms and 'other voices heard' make it unreliable."""
    lo, hi = C.PHONEME_SNR_DB
    trust = C.PHONEME_TRUST_FLOOR + (1 - C.PHONEME_TRUST_FLOOR) * ramp(snr_db, lo, hi)
    if insertion_ratio is not None and insertion_ratio > C.PHONEME_INSERTION_RATIO:
        trust *= C.PHONEME_INSERTION_TRUST
    return float(trust)


def edge_missing(per_phone: list[tuple[str, float]]) -> tuple[bool, bool]:
    """(start_missing, end_missing) from per-target-phone ln-posteriors: the first (or last) few phones all near the floor
    while the rest of the sentence scored fine means the clip lost that end (late mic start, early stop), not slurring."""
    n = C.PHONEME_EDGE_PHONES
    lp = [float(v) for _, v in per_phone]
    if len(lp) < 2 * n + 2:
        return False, False

    def missing(edge: list[float], rest: list[float]) -> bool:
        return all(v <= C.PHONEME_EDGE_LOGP for v in edge) and sum(rest) / len(rest) >= C.PHONEME_EDGE_REST_LOGP

    return missing(lp[:n], lp[n:]), missing(lp[-n:], lp[:-n])


def severity_cap(components: Mapping[str, float]) -> tuple[float | None, str]:
    """Agreement rule: (cap, reason); cap is None when the evidence is corroborated.

    An ELEVATED (>= AGREE_MIN) QUALITY component (phoneme model, jitter/shimmer) needs at least one TIMING component
    (rate, pausing, prosody, transcript) >= QUALITY_NEEDS_TIMING_MIN. An elevated TIMING component needs a second timing
    component or a quality one >= TIMING_SUPPORT_MIN. Rooms, mics, accents and codecs move the quality group; they rarely move timing.
    Otherwise severity is capped (config: QUALITY_ONLY_CAP / TIMING_ONLY_CAP / NO_SIGNAL_CAP)."""
    g = components.get
    q_hi = [k for k in C.QUALITY_COMPONENTS if g(k, 0.0) >= C.AGREE_MIN]
    t_hi = [k for k in C.TIMING_COMPONENTS if g(k, 0.0) >= C.AGREE_MIN]
    q_support = [k for k in C.QUALITY_COMPONENTS if g(k, 0.0) >= C.TIMING_SUPPORT_MIN]
    t_support = [k for k in C.TIMING_COMPONENTS if g(k, 0.0) >= C.TIMING_SUPPORT_MIN]
    t_corroborates = [k for k in C.TIMING_COMPONENTS if g(k, 0.0) >= C.QUALITY_NEEDS_TIMING_MIN]
    if (q_hi and t_corroborates) or (t_hi and (len(t_support) >= 2 or q_support)):
        return None, ""
    if t_hi:
        return max(C.TIMING_ONLY_CAP[k] for k in t_hi), "timing-only"
    if q_hi:
        return C.QUALITY_ONLY_CAP, "quality-only"
    return C.NO_SIGNAL_CAP, "no-signal"


def score_metrics(metrics: Mapping[str, float]) -> Score:
    """metrics -> components -> weights renormalized over the available ones -> severity 0..1 (then the agreement cap)."""
    comps = component_scores(metrics)
    total_w = sum(C.WEIGHTS[k] for k in comps)
    if not comps or total_w <= 0:
        return Score(0.0, 0.0)
    weights = {k: C.WEIGHTS[k] / total_w for k in comps}
    wsum = float(sum(weights[k] * comps[k] for k in comps))
    raw = ramp(wsum, *C.SEVERITY_MAP)
    cap, reason = severity_cap(comps)
    sev = raw if cap is None else min(raw, cap)
    return Score(severity=sev, weighted_sum=wsum, components=comps, weights=weights, uncapped_severity=raw, cap_reason=reason if sev < raw else "")


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


def _flags_for(components: Mapping[str, float], metrics: Mapping[str, float], bad_phones: list[str], quality_uncorroborated: bool = False) -> list[str]:
    t = C.FLAG_MIN_COMPONENT
    flags: list[str] = []
    if quality_uncorroborated:  # do not headline findings the timing signals did not back up (room / mic / accent effects)
        components = {k: v for k, v in components.items() if k not in C.QUALITY_COMPONENTS}
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


REASON_BACKGROUND_VOICES = "I can hear other voices or sound in the background, please move somewhere quieter and try again"
REASON_WRONG_SENTENCE = "that didn't sound like the sentence, please read it exactly as shown"
REASON_TOO_LONG = "that recording was too long, please say just the sentence"
FLAG_NOISY = "noisy room, this result may be unreliable"
FLAG_PHONEME_UNAVAILABLE = "phoneme check unavailable, timing and voice only"
FLAG_PHONEME_ENGLISH_ONLY = "phoneme scoring is English-only, DSP checks only"

_RETRY_FOR_TERM = {
    "snr": "too much background noise",
    "duration": "too short, please say the whole sentence",
    "voice": "couldn't pick up your voice clearly, please speak up",
}


# ----------------------------------------------------------------------------------------------------------
# Optional evidence
# ----------------------------------------------------------------------------------------------------------
def _phoneme_scores(samples: np.ndarray, target_phrase: str):
    """Agent B's wav2vec2 scorer, or None if the module/torch is missing, it declines, or it is too slow. Never raises.

    Runs in a worker thread with a budget (`PHONEME_TIMEOUT_S`) so a cold model load or a stuck inference degrades to a
    DSP-only result instead of a whole-endpoint timeout. The worker cannot be cancelled; its result is discarded."""
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="phoneme")
    try:
        from models import (
            phoneme,  # lazy: may not exist, and importing it may pull torch
        )

        fut = pool.submit(phoneme.score_phonemes, samples, C.SAMPLE_RATE, target_phrase)
        return fut.result(timeout=C.PHONEME_TIMEOUT_S)
    except FutureTimeout:
        log.warning("phoneme scoring timed out after %.1fs, continuing without it", C.PHONEME_TIMEOUT_S)
        return None
    except Exception as exc:  # noqa: BLE001 - ImportError, missing torch, model load, inference errors
        log.debug("phoneme scoring unavailable: %s", type(exc).__name__)
        return None
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


def _phoneme_wanted() -> bool:
    try:
        from models import phoneme

        return phoneme.phoneme_scoring_enabled()
    except Exception:  # noqa: BLE001
        return False


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
def analyze_speech(wav_bytes: bytes, target_phrase: str, transcriber: Transcriber | None = None, lang: str = C.DEFAULT_LANG) -> TestResult:
    """Analyze a recording of the patient repeating `target_phrase`. Never raises.

    `lang` is the language of the sentence ("en" or "es"); anything other than English is scored without the phoneme model."""
    started_at = int(time.time() * 1000)
    t0 = time.perf_counter()
    try:
        return _analyze(wav_bytes, target_phrase, transcriber, started_at, t0, lang)
    except Exception as exc:  # noqa: BLE001
        log.error("speech analysis failed (%s)", type(exc).__name__)  # type only: no traceback/message from audio data
        return _retry("something went wrong analysing that, please try again", started_at, t0)


def _analyze(wav_bytes: bytes, target_phrase: str, transcriber: Transcriber | None, started_at: int, t0: float, lang: str = C.DEFAULT_LANG) -> TestResult:
    sr = C.SAMPLE_RATE
    samples, err = load_wav(wav_bytes, sr)
    if samples is None:
        if err == "recording too long":
            return _retry(REASON_TOO_LONG, started_at, t0)
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
        target_syll = count_syllables(target_phrase)
        if target_syll > 0:
            metrics["nuclei_per_target_syllable"] = len(nuclei) / target_syll
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
        english = lang == C.DEFAULT_LANG
        if not english:
            flags.append(FLAG_PHONEME_ENGLISH_ONLY)  # the wav2vec2 phoneme model only knows English sounds: never run it here
        ph_wanted = english and _phoneme_wanted()
        ph = _phoneme_scores(trimmed, target_phrase) if ph_wanted else None
        bad_phones: list[str] = []
        if ph is not None:
            try:
                got = {k: float(getattr(ph, k)) for k in ("per", "gop_mean", "gop_min", "n_bad_phones")}
                if all(math.isfinite(v) for v in got.values()):
                    metrics.update(got)
                    bad_phones = [str(p) for p in getattr(ph, "bad_phones", [])]
                    try:
                        start_gone, end_gone = edge_missing(list(getattr(ph, "per_phone", []) or []))
                    except Exception:  # noqa: BLE001 - odd per_phone shape: no edge information
                        start_gone = end_gone = False
                    if start_gone or end_gone:
                        metrics["phoneme_edge_missing"] = float(start_gone) + 2.0 * float(end_gone)  # 1 start, 2 end, 3 both
                    n_target = len(str(getattr(ph, "target", "")).split())
                    if n_target:
                        metrics["phoneme_insertion_ratio"] = len(str(getattr(ph, "decoded", "")).split()) / n_target
            except Exception:  # noqa: BLE001 - malformed result object: treat as "no phoneme scores"
                pass
        has_phoneme = "per" in metrics
        if not has_phoneme and ph_wanted:
            flags.append(FLAG_PHONEME_UNAVAILABLE)

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
    if has_phoneme:
        ins = metrics.get("phoneme_insertion_ratio")
        trust = phoneme_trust(metrics["snr_db"], ins)
        edge = int(metrics.get("phoneme_edge_missing", 0))
        if edge:
            trust *= C.PHONEME_EDGE_TRUST
            flags.append(("the start" if edge == 1 else "the end" if edge == 2 else "the start and end") + " of the sentence may be missing from the recording")
        metrics["phoneme_trust"] = round(trust, 4)
    score = score_metrics(metrics)
    trust = metrics.get("phoneme_trust", 1.0)
    mismatch = has_phoneme and metrics["per"] >= C.PHONEME_MISMATCH[0] and metrics["gop_mean"] <= C.PHONEME_MISMATCH[1]
    timing_agrees = any(score.components.get(k, 0.0) >= C.AGREE_MIN for k in C.TIMING_COMPONENTS)
    # Retry only when TIMING shows nothing wrong OR far more was said than the sentence (a real slow/halting speaker who also
    # trips these checks is scored, so the patient is never told "move somewhere quiet" forever; slurring never ADDS syllables).
    overrun = metrics.get("nuclei_per_target_syllable", 0.0) >= C.SYLLABLE_OVERRUN_RATIO
    if has_phoneme and (not timing_agrees or overrun):
        if metrics.get("phoneme_insertion_ratio", 0.0) >= C.PHONEME_BACKGROUND_RATIO:  # other voices dominate what the model "heard"
            return _retry(REASON_BACKGROUND_VOICES, started_at, t0, metrics)
        if mismatch:  # a different sentence (or none): the app cannot judge slurring from that
            return _retry(REASON_WRONG_SENTENCE, started_at, t0, metrics)
    confidence, weakest = compute_confidence(
        metrics["snr_db"], metrics["utterance_s"], metrics.get("voiced_fraction", 0.0), has_transcript, has_phoneme and trust >= C.PHONEME_TRUSTED
    )
    severity = score.severity
    noisy = metrics["snr_db"] < C.NOISY_SNR_DB
    if noisy:
        severity = min(severity, C.POOR_CONDITIONS_SEVERITY_CAP)
        confidence *= C.POOR_CONDITIONS_CONFIDENCE_FACTOR
        flags.append(FLAG_NOISY)
    if not english:
        severity = min(severity, C.NON_ENGLISH_SEVERITY_CAP)  # English-calibrated timing only: never a high severity on its own
    if confidence < C.MIN_CONFIDENCE:
        return _retry(_RETRY_FOR_TERM[weakest], started_at, t0, metrics, confidence)

    flags = _flags_for(score.components, metrics, bad_phones, quality_uncorroborated=severity_cap(score.components)[1] == "quality-only") + flags
    log.debug("speech severity=%.2f conf=%.2f components=%s", severity, confidence, score.components)
    return TestResult(
        test="speech",
        severity=round(severity, 4),
        confidence=round(confidence, 4),
        metrics=metrics,
        flags=flags,
        started_at=started_at,
        duration_ms=int((time.perf_counter() - t0) * 1000),
        needs_retry=False,
        transcript=transcript.text if transcript is not None else None,
    )
