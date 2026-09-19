"""Pure statistics + split helpers for held-out validation (speech side; the vision tool mirrors these in TypeScript).

Shared spec (keep byte-compatible with the TypeScript tool):
* Deterministic subject split: bucket = int(sha1(subject.strip().lower())[:8 hex], 16) % 100; < 60 -> tune, else validate.
* Wilson score interval, two-sided 95% (z = 1.96) and one-sided 95% bounds (z = 1.645).
* percentile: linear interpolation between closest ranks (numpy's default); median = percentile 50.
No I/O, no torch, no audio: importable anywhere.
"""
from __future__ import annotations

import hashlib
import math
from typing import Any, Mapping, Sequence

from models.calibrate import auc, cohens_d  # noqa: F401  (re-exported: P(deficit > healthy) with ties 0.5; pooled-sd Cohen's d)

Z_TWO_SIDED_95 = 1.96
Z_ONE_SIDED_95 = 1.645
TUNE_BUCKET_LIMIT = 60  # bucket < 60 -> tune (60 %), else validate (40 %)
SPLITS = ("tune", "validate")


class SplitError(ValueError):
    """Unusable split override (bad shape, or a subject listed in both splits)."""


# ---------- intervals ----------

def wilson(k: int | float, n: int, z: float = Z_TWO_SIDED_95) -> tuple[float, float]:
    """Wilson score interval (lo, hi) for k successes out of n, clamped to [0, 1]. n == 0 -> (nan, nan)."""
    if n <= 0:
        return (math.nan, math.nan)
    p = k / n
    z2 = z * z
    denom = 1 + z2 / n
    center = (p + z2 / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom
    return (max(0.0, center - half), min(1.0, center + half))


# ---------- descriptive ----------

def percentile(values: Sequence[float], q: float) -> float:
    """q in [0, 100]; linear interpolation between closest ranks (numpy default). Empty -> nan."""
    xs = sorted(values)
    if not xs:
        return math.nan
    if len(xs) == 1:
        return float(xs[0])
    pos = (len(xs) - 1) * max(0.0, min(100.0, q)) / 100.0
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(xs) - 1)
    return float(xs[lo] + (xs[hi] - xs[lo]) * (pos - lo))


def median(values: Sequence[float]) -> float:
    return percentile(values, 50)


# ---------- split ----------

def normalize_subject(subject: str) -> str:
    return subject.strip().lower()


def bucket_for(subject: str) -> int:
    return int(hashlib.sha1(normalize_subject(subject).encode("utf-8")).hexdigest()[:8], 16) % 100


def parse_split_override(obj: Any) -> dict[str, str]:
    """{"tune": [...], "validate": [...]} -> {normalized subject: split}. A subject in both lists is a SplitError."""
    if not isinstance(obj, dict):
        raise SplitError('split file must be a JSON object like {"tune": [...], "validate": [...]}')
    unknown = sorted(set(obj) - set(SPLITS))
    if unknown:
        raise SplitError(f"split file has unknown keys {unknown}; only 'tune' and 'validate' are allowed")
    out: dict[str, str] = {}
    conflicts: set[str] = set()
    for split in SPLITS:
        names = obj.get(split, [])
        if not isinstance(names, list) or not all(isinstance(s, str) for s in names):
            raise SplitError(f"split file '{split}' must be a list of subject names")
        for name in names:
            key = normalize_subject(name)
            if key in out and out[key] != split:
                conflicts.add(key)
            out[key] = split
    if conflicts:
        raise SplitError(f"subject(s) listed in both tune and validate: {', '.join(sorted(conflicts))}")
    return out


def split_for(subject: str, override: Mapping[str, str] | None = None) -> str:
    """'tune' or 'validate'. `override` is the normalized mapping from parse_split_override; it wins over the hash."""
    key = normalize_subject(subject)
    if override and key in override:
        return override[key]
    return "tune" if bucket_for(subject) < TUNE_BUCKET_LIMIT else "validate"
