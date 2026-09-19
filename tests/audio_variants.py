"""Environment / speaker / microphone perturbations for speech-robustness tests (numpy + scipy only).

Everything takes and returns float32 mono at 16 kHz. Apply them to a clean base clip (a TTS render of the phrase, or
tests/audio_synth.py output) to ask: "would a healthy person in THIS room, on THIS mic, speaking THIS way be flagged?"
These are crude models of real conditions, not recordings; they prove the pipeline degrades gracefully, they do not
calibrate it.
"""
from __future__ import annotations

import numpy as np
from scipy.signal import butter, fftconvolve, lfilter, resample_poly, sosfilt

SR = 16000


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x, dtype=np.float64)) + 1e-20))


def active_rms(x: np.ndarray, frame: int = 400) -> float:
    """RMS of the loud frames (top 40 %), a fair 'speech level' for a clip that has silence around it."""
    n = len(x) // frame
    if n == 0:
        return _rms(x)
    fr = x[: n * frame].reshape(n, frame)
    lev = np.sqrt(np.mean(fr**2, axis=1))
    return float(np.sqrt(np.mean(lev[lev >= np.quantile(lev, 0.6)] ** 2)) + 1e-12)


def pad(x: np.ndarray, lead_s: float = 0.4, trail_s: float = 0.6, floor: float = 0.0, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    lead = rng.standard_normal(int(lead_s * SR)) * floor
    trail = rng.standard_normal(int(trail_s * SR)) * floor
    return np.concatenate([lead, x, trail]).astype(np.float32)


def set_level(x: np.ndarray, dbfs: float) -> np.ndarray:
    """Scale so the loud frames sit at `dbfs` RMS."""
    return (x * (10 ** (dbfs / 20) / active_rms(x))).astype(np.float32)


def _colored_noise(n: int, kind: str, rng: np.random.Generator) -> np.ndarray:
    w = rng.standard_normal(n)
    if kind == "white":
        return w
    if kind == "pink":  # ~ -3 dB/oct via a one-pole cascade approximation
        b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
        a = [1, -2.494956002, 2.017265875, -0.522189400]
        return lfilter(b, a, w)
    if kind == "hum":  # fan / HVAC rumble: low-passed noise + mains hum
        sos = butter(2, 300, "low", fs=SR, output="sos")
        t = np.arange(n) / SR
        return sosfilt(sos, w) * 3 + 0.4 * np.sin(2 * np.pi * 60 * t)
    raise ValueError(kind)


def add_noise(x: np.ndarray, snr_db: float, kind: str = "white", seed: int = 0) -> np.ndarray:
    """Add noise at `snr_db` relative to the loud-frame speech level."""
    rng = np.random.default_rng(seed)
    nz = _colored_noise(len(x), kind, rng)
    nz = nz / _rms(nz) * (active_rms(x) / 10 ** (snr_db / 20))
    return (x + nz).astype(np.float32)


def add_background(x: np.ndarray, bg: np.ndarray, snr_db: float, offset_s: float = 0.0) -> np.ndarray:
    """Mix a continuous background (TV / other talkers / music) at `snr_db` vs the loud-frame speech level."""
    reps = int(np.ceil((len(x) + int(offset_s * SR)) / max(1, len(bg)))) + 1
    b = np.tile(bg, reps)[int(offset_s * SR) : int(offset_s * SR) + len(x)]
    b = b / _rms(b) * (active_rms(x) / 10 ** (snr_db / 20))
    return (x + b).astype(np.float32)


def music(n: int, seed: int = 0) -> np.ndarray:
    """A few sustained chords with slow amplitude swells: steady, harmonic, unlike speech."""
    rng = np.random.default_rng(seed)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for f in (220.0, 277.2, 329.6, 440.0, 554.4):
        out += np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * (0.6 + 0.4 * np.sin(2 * np.pi * rng.uniform(0.2, 0.7) * t))
    return out.astype(np.float32)


def reverb(x: np.ndarray, rt60_s: float, seed: int = 0) -> np.ndarray:
    """Convolve with exponentially decaying noise (a diffuse-room impulse response)."""
    rng = np.random.default_rng(seed)
    n = int(rt60_s * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * 10 ** (-3 * t / rt60_s)  # -60 dB at rt60
    ir[0] = 1.0
    ir /= np.sqrt(np.sum(ir**2))
    y = fftconvolve(x, ir)[: len(x)]
    return (y / _rms(y) * _rms(x)).astype(np.float32)


def bandlimit(x: np.ndarray, lo_hz: float, hi_hz: float) -> np.ndarray:
    """Cheap laptop / Bluetooth-headset mic: no bass, no treble."""
    sos = butter(2, [lo_hz, min(hi_hz, SR / 2 - 100)], "band", fs=SR, output="sos")
    y = sosfilt(sos, x)
    return (y / (_rms(y) + 1e-12) * _rms(x)).astype(np.float32)


def bluetooth_sco(x: np.ndarray) -> np.ndarray:
    """Headset (SCO/HFP) call quality: 8 kHz band-limit, 300-3400 Hz, then back to 16 kHz."""
    lo = resample_poly(bandlimit(x, 300, 3400), 1, 2)
    return resample_poly(lo, 2, 1).astype(np.float32)


def roundtrip_rate(x: np.ndarray, rate: int) -> np.ndarray:
    """What a 44.1 / 48 kHz device followed by a clean resampler to 16 kHz looks like."""
    from math import gcd

    g = gcd(rate, SR)
    up = resample_poly(x, rate // g, SR // g)
    return resample_poly(up, SR // g, rate // g).astype(np.float32)


def clip_hard(x: np.ndarray, gain: float) -> np.ndarray:
    return np.clip(x * gain, -1.0, 1.0).astype(np.float32)


def cough(x: np.ndarray, at_s: float, dur_s: float = 0.35, rel_level: float = 1.5, seed: int = 0) -> np.ndarray:
    """A short loud broadband burst at `at_s` (level relative to loud speech frames)."""
    rng = np.random.default_rng(seed)
    n = int(dur_s * SR)
    burst = rng.standard_normal(n) * np.hanning(n) ** 2
    burst = burst / _rms(burst) * active_rms(x) * rel_level
    y = x.copy()
    a = int(at_s * SR)
    y[a : a + n] += burst[: len(y[a : a + n])]
    return y.astype(np.float32)


def insert_pause(x: np.ndarray, at_s: float, dur_s: float, floor: float = 0.0, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    a = int(at_s * SR)
    return np.concatenate([x[:a], rng.standard_normal(int(dur_s * SR)) * floor, x[a:]]).astype(np.float32)


def stretch(x: np.ndarray, rate: float) -> np.ndarray:
    """Natural speaking-rate change without pitch change (rate 1.25 = 25 % faster)."""
    import librosa

    return librosa.effects.time_stretch(x.astype(np.float32), rate=rate).astype(np.float32)


def pitch_shift(x: np.ndarray, semitones: float) -> np.ndarray:
    import librosa

    return librosa.effects.pitch_shift(x.astype(np.float32), sr=SR, n_steps=semitones).astype(np.float32)


def vocal_tract_shift(x: np.ndarray, factor: float) -> np.ndarray:
    """Resample-based shift of pitch AND formants together (factor 1.15 = a smaller vocal tract), then restore duration.
    A crude stand-in for 'a different speaker' (different formant space than the reader the model was trained on)."""
    from math import gcd

    num, den = int(round(factor * 100)), 100
    g = gcd(num, den)
    y = resample_poly(x, den // g, num // g)  # speeds up by `factor` (raises pitch + formants)
    return stretch(y.astype(np.float32), 1.0 / factor) if abs(factor - 1) > 1e-6 else x


def accent_drift(x: np.ndarray, seed: int = 0) -> np.ndarray:
    """Non-native-ish prosody: slight vocal-tract change + a flatter, slower delivery."""
    return stretch(vocal_tract_shift(x, 1.08), 0.9)


def cut(x: np.ndarray, start_s: float = 0.0, end_s: float = 0.0) -> np.ndarray:
    a = int(start_s * SR)
    b = len(x) - int(end_s * SR)
    return x[a:b].astype(np.float32)
