"""Synthetic speech-LIKE audio for tests. Reusable: `from tests.audio_synth import synth_speech, healthy, impaired`.

IMPORTANT: this is NOT speech. It is a glottal pulse train (with controllable F0 contour, jitter and shimmer)
through fixed vowel-like formant filters, amplitude-modulated at the syllable rate, with optional pauses,
breathiness and background noise. It exercises the DSP paths with known ground truth; it says nothing about how
real healthy or dysarthric speakers will score. Thresholds tuned against it are UNCALIBRATED.

Ground truth is returned with the samples (`SynthSpeech`): syllable centres, pause intervals, speech bounds.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field

import numpy as np
import soundfile as sf
from scipy.signal import lfilter, resample_poly

SR = 16000
OVERSAMPLE = 4


@dataclass
class SynthSpeech:
    samples: np.ndarray  # float32 mono, SR
    sr: int = SR
    syllable_times: list[float] = field(default_factory=list)  # s, syllable centres
    pause_intervals: list[tuple[float, float]] = field(default_factory=list)  # s, inserted pauses
    speech_start_s: float = 0.0
    speech_end_s: float = 0.0
    n_syllables: int = 0

    @property
    def duration_s(self) -> float:
        return len(self.samples) / self.sr

    def wav(self, subtype: str = "PCM_16") -> bytes:
        return to_wav_bytes(self.samples, self.sr, subtype)


def to_wav_bytes(samples: np.ndarray, sr: int = SR, subtype: str = "PCM_16") -> bytes:
    buf = io.BytesIO()
    sf.write(buf, np.asarray(samples, dtype=np.float32), sr, format="WAV", subtype=subtype)
    return buf.getvalue()


def _resonator(x: np.ndarray, freq: float, bw: float, sr: int) -> np.ndarray:
    r = np.exp(-np.pi * bw / sr)
    theta = 2 * np.pi * freq / sr
    a = [1.0, -2 * r * np.cos(theta), r * r]
    return lfilter([1.0 - r], a, x)


def _vowel_filter(x: np.ndarray, sr: int) -> np.ndarray:
    for f, bw in ((700, 110), (1220, 120), (2600, 160)):
        x = _resonator(x, f, bw, sr)
    return x


def synth_speech(
    *,
    n_syllables: int = 8,
    syllable_rate: float = 4.5,  # syllables/s while speaking (articulation rate, excludes inserted pauses)
    pauses: dict[int, float] | None = None,  # {after_syllable_index: pause_seconds}
    f0_hz: float = 120.0,
    f0_sd_st: float = 3.0,  # semitone SD of the per-syllable pitch targets (0 = monotone)
    jitter: float = 0.004,  # local jitter as a fraction of the period
    shimmer: float = 0.03,  # local shimmer as a fraction of the amplitude
    breathiness: float = 0.0,  # aspiration-noise RMS relative to the voiced RMS (0.3 ~ 10 dB HNR)
    snr_db: float = 35.0,  # broadband background noise vs speech RMS
    level_dbfs: float = -20.0,  # RMS of the speech-active parts
    dip: float = 0.25,  # envelope floor between syllables inside a chunk (0.25 = -12 dB)
    voiced: bool = True,  # False = whisper (noise-excited, no pitch)
    lead_s: float = 0.4,
    trail_s: float = 1.0,
    sr: int = SR,
    seed: int = 0,
) -> SynthSpeech:
    rng = np.random.default_rng(seed)
    out_sr, sr = sr, sr * OVERSAMPLE  # synthesize oversampled so fractional glottal-pulse timing does not add its own jitter/shimmer
    pauses = pauses or {}
    period = 1.0 / syllable_rate
    onsets: list[float] = []
    t = lead_s
    pause_iv: list[tuple[float, float]] = []
    for i in range(n_syllables):
        onsets.append(t)
        t += period
        if i in pauses and i < n_syllables - 1:
            pause_iv.append((t, t + pauses[i]))
            t += pauses[i]
    speech_end = t
    total = speech_end + trail_s
    n = int(round(total * sr))
    tt = np.arange(n) / sr

    # Envelope: `dip` inside chunks (runs of syllables without a pause), 0 in pauses/lead/trail, hann bumps per syllable.
    env = np.zeros(n)
    chunk_start = onsets[0]
    for i in range(n_syllables):
        last_in_chunk = i == n_syllables - 1 or (i in pauses)
        if last_in_chunk:
            a, b = int(round(chunk_start * sr)), int(round((onsets[i] + period) * sr))
            env[a:b] = dip
            if i < n_syllables - 1:
                chunk_start = onsets[i + 1]
    centres = [o + period / 2 for o in onsets]
    for o in onsets:
        a, b = int(round(o * sr)), int(round((o + period) * sr))
        env[a:b] += (1 - dip) * np.hanning(b - a)
    k = max(1, int(0.01 * sr))
    env = np.convolve(env, np.ones(k) / k, mode="same")

    # F0 contour (Hz) from per-syllable semitone targets.
    targets = rng.standard_normal(n_syllables)
    targets = (targets - targets.mean()) / (targets.std() + 1e-9) * f0_sd_st  # exact SD across syllables (deterministic)
    f0_track = f0_hz * 2.0 ** (np.interp(tt, centres, targets) / 12.0)

    voiced_sig = np.zeros(n)
    if voiced:
        pos = onsets[0] * sr
        end = speech_end * sr
        while pos < end:
            idx = int(pos)
            if idx + 1 >= n:
                break
            amp = env[idx] * (1.0 + shimmer / 1.128 * rng.standard_normal())
            frac = pos - idx
            voiced_sig[idx] += amp * (1 - frac)
            voiced_sig[idx + 1] += amp * frac
            T = sr / f0_track[idx] * (1.0 + jitter / 1.128 * rng.standard_normal())
            pos += max(T, 2.0)
        voiced_sig = lfilter([1.0], [1.0, -0.97], voiced_sig)
        voiced_sig = lfilter([1.0], [1.0, -0.90], voiced_sig)
        voiced_sig = _vowel_filter(voiced_sig, sr)
    active = env > 0.05
    v_rms = float(np.sqrt(np.mean(voiced_sig[active] ** 2))) if voiced and active.any() else 0.0

    noise_amp = breathiness if voiced else 1.0
    asp = _vowel_filter(rng.standard_normal(n) * env, sr)
    a_rms = float(np.sqrt(np.mean(asp[active] ** 2))) if active.any() else 1.0
    sig = voiced_sig + (asp / (a_rms + 1e-12)) * noise_amp * (v_rms if voiced else 1.0)
    rms = float(np.sqrt(np.mean(sig[active] ** 2))) if active.any() else 1.0
    target_rms = 10 ** (level_dbfs / 20)
    sig = resample_poly(sig / (rms + 1e-12) * target_rms, 1, OVERSAMPLE)
    if snr_db < 200:
        sig = sig + rng.standard_normal(sig.size) * target_rms / (10 ** (snr_db / 20))
    sig = np.clip(sig, -0.999, 0.999).astype(np.float32)
    return SynthSpeech(
        samples=sig,
        sr=out_sr,
        syllable_times=centres,
        pause_intervals=pause_iv,
        speech_start_s=onsets[0],
        speech_end_s=speech_end,
        n_syllables=n_syllables,
    )


# Presets. Numbers chosen to sit in clearly-healthy / borderline / clearly-impaired regions of the (uncalibrated) ramps.
def healthy(**kw) -> SynthSpeech:
    """Fluent, expressive, clean voice, ~4.5 syllables/s."""
    return synth_speech(**{**dict(syllable_rate=4.5, f0_sd_st=3.5, jitter=0.004, shimmer=0.03, breathiness=0.05, seed=1), **kw})


def fast_healthy(**kw) -> SynthSpeech:
    """A fast talker (~6 syllables/s), still healthy."""
    return healthy(**{**dict(syllable_rate=6.0, seed=2), **kw})


def quiet_healthy(**kw) -> SynthSpeech:
    """A soft-spoken healthy talker in a quiet room (-35 dBFS RMS, 30 dB SNR)."""
    return healthy(**{**dict(level_dbfs=-35.0, snr_db=30.0, seed=3), **kw})


def borderline(**kw) -> SynthSpeech:
    """Slightly slow, one noticeable pause, a bit flat and a bit rough."""
    return synth_speech(**{**dict(syllable_rate=2.4, pauses={3: 0.8}, f0_sd_st=1.2, jitter=0.010, shimmer=0.04,
                                  breathiness=0.12, snr_db=32.0, seed=4), **kw})


def impaired(**kw) -> SynthSpeech:
    """Slow, halting (two long pauses), monotone, rough/breathy: the 'clearly dysarthria-like' region."""
    return synth_speech(**{**dict(syllable_rate=1.9, pauses={2: 1.0, 5: 0.8}, f0_sd_st=0.15, jitter=0.04, shimmer=0.12,
                                  breathiness=0.5, snr_db=28.0, seed=5), **kw})
