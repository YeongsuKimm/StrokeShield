"""Phoneme-level speech scoring: CTC forced alignment (GOP) + phoneme error rate (PER).

Why: modern STT auto-corrects mumbling, so a transcript can look perfect on slurred speech. A pretrained
wav2vec2 *phoneme* recognizer reports what was actually articulated. We compare that against the KNOWN
target phoneme sequence of the fixed test phrase. No training / fine-tuning, no patient data.

Two signals
-----------
* PER  - greedy CTC decode of the model, edit distance to the target / len(target).
         0 = perfect, ~0.1-0.3 = normal recogniser noise, higher = worse. Can exceed 1.
* GOP  - Goodness of Pronunciation. The target sequence is force-aligned (CTC Viterbi) to the frame
         posteriors; each target phoneme gets the natural-log posterior of that phoneme at its
         *peak emitting frame* (CTC is "peaky": a phoneme is emitted on 1-3 frames, the rest is blank).
         Scale per phoneme: ln p in [GOP_FLOOR, 0]; 0 = model is certain the phoneme was produced,
         ln(0.5) = -0.69 = coin flip, -10 = floor (clamped). HIGHER = BETTER articulated.
         A phoneme is "bad" when ln p < BAD_PHONE_LOGP.

Direction of badness (for the severity ramp, computed elsewhere): per UP = worse; gop_mean DOWN = worse;
gop_min DOWN = worse; n_bad_phones UP = worse.

Everything numeric (decode collapse, edit distance, forced alignment, GOP aggregation) is PURE numpy and
importable without torch. torch / transformers are imported lazily inside functions only, so the torch-free
Railway backup image can import this module and simply gets ``None`` from ``score_phonemes``.

Adding a phrase
---------------
TARGET_PHONEMES below holds the target sequence per (normalized) phrase in the model's vocabulary
(ARPAbet-39, TIMIT style, lower-case, no stress marks). To add one: look up each word in CMUdict
(http://www.speech.cs.cmu.edu/cgi-bin/cmudict), drop stress digits, map to the 39-phone set
(ax->ah, ix->ih, axr->er, dx->d/t, ao->aa: this vocab has NO ao), then apply the connected-speech rules below, and finally check with
``python -m models.phoneme --check "<phrase>"`` (every phone must exist in the model vocab.json).
Rules used: no silence tokens; an identical phoneme pair across a word boundary ("can't teach" t+t,
"old dog" d+d) is merged into ONE phoneme, because speakers produce one long closure and CTC emits it once
(keeping both would make every normal speaker lose a phoneme in PER).
"""

from __future__ import annotations

import importlib.util
import logging
import math
import os
import re
import string
import threading
import time
from dataclasses import dataclass, field

import numpy as np

log = logging.getLogger("strokeshield.phoneme")

# ---------------------------------------------------------------------------------------------------
# Configuration (all UNCALIBRATED until tuned on real recordings; see docs/spec/03-speech.md)
# ---------------------------------------------------------------------------------------------------
# Own constant on purpose (models/config.py PHONEME_MODEL is a placeholder for a different, 1.2 GB model).
# Model: base wav2vec2 (95M params, 361 MB) fine-tuned on TIMIT, output = 39 ARPAbet phones + <pad>(blank) + <unk>.
PHONEME_MODEL_ID = os.getenv("PHONEME_MODEL_ID", "mostafaashahin/wav2vec2-base-timit-phoneme-arpa-39")
MODEL_SAMPLE_RATE = 16_000
FRAME_S = 0.02  # wav2vec2 stride: 320 samples @ 16 kHz

MIN_AUDIO_S = 0.5   # shorter than this -> None
MAX_AUDIO_S = 15.0  # longer is truncated (bounds latency)
MIN_PEAK = 1e-3     # digital silence -> None
GOP_FLOOR = -10.0   # per-phoneme ln-posterior clamp
BAD_PHONE_LOGP = math.log(0.2)  # phoneme is "bad" when its peak posterior is < 0.2  (ln 0.2 = -1.61)

_TRUE = {"1", "true", "yes", "on"}

# Hardcoded target phonemes (ARPAbet-39). See module docstring for how they were derived.
TARGET_PHONEMES: dict[str, str] = {
    # y-uw k-ae-n-t (t+t merged) iy-ch ae-n ow-l-d (d+d merged) aa-g (ao->aa) n-uw t-r-ih-k-s
    "you cant teach an old dog new tricks": "y uw k ae n t iy ch ae n ow l d aa g n uw t r ih k s",
    # n-ah-th-ih-ng b-iy-t-s ah jh-aa-l-iy g-uh-d b-r-eh-k-f-ah-s-t
    "nothing beats a jolly good breakfast": "n ah th ih ng b iy t s ah jh aa l iy g uh d b r eh k f ah s t",
    # dh-ey hh-er-d hh-ih-m s-p-iy-k aa-n dh-ah r-ey-d-iy-ow l-ae-s-t n-ay-t
    "they heard him speak on the radio last night": (
        "dh ey hh er d hh ih m s p iy k aa n dh ah r ey d iy ow l ae s t n ay t"
    ),
}


# ---------------------------------------------------------------------------------------------------
# Result type (FIXED public interface; new fields may only be appended with defaults)
# ---------------------------------------------------------------------------------------------------
@dataclass
class PhonemeScores:
    per: float            # phoneme error rate, 0..1+ (edit distance decoded vs target / len(target)); UP = worse
    gop_mean: float       # mean per-phoneme ln-posterior in [GOP_FLOOR, 0] from forced alignment; DOWN = worse
    gop_min: float        # worst phoneme's ln-posterior; DOWN = worse
    n_bad_phones: int     # phonemes with ln p < BAD_PHONE_LOGP
    bad_phones: list[str]  # target phonemes (in order, with repeats) that scored badly, e.g. ["k", "t"]
    decoded: str          # greedy CTC decode, space-separated phones
    target: str           # target phoneme sequence used, space-separated
    duration_s: float     # audio seconds analysed
    elapsed_s: float      # compute time (resample + model + scoring)
    # --- appended, optional ---
    per_phone: list[tuple[str, float]] = field(default_factory=list)  # (phone, ln p) for every target phone
    model: str = ""


# ---------------------------------------------------------------------------------------------------
# PURE math (numpy only)
# ---------------------------------------------------------------------------------------------------
def normalize_phrase(phrase: str) -> str:
    """Lower-case, strip punctuation (incl. apostrophes) and collapse whitespace."""
    p = phrase.lower().replace("’", "'")
    p = "".join(ch for ch in p if ch not in string.punctuation)
    return re.sub(r"\s+", " ", p).strip()


def target_phonemes(phrase: str) -> list[str] | None:
    """Hardcoded target phoneme list for a phrase, or None if the phrase is unknown."""
    seq = TARGET_PHONEMES.get(normalize_phrase(phrase))
    return seq.split() if seq else None


def log_softmax(logits: np.ndarray) -> np.ndarray:
    """Row-wise, numerically stable log-softmax over the last axis."""
    x = np.asarray(logits, dtype=np.float64)
    m = x.max(axis=-1, keepdims=True)
    return x - m - np.log(np.exp(x - m).sum(axis=-1, keepdims=True))


def ctc_greedy_decode(log_probs: np.ndarray, blank: int) -> list[int]:
    """Argmax per frame, collapse consecutive repeats, drop blanks (standard CTC decode)."""
    ids = np.asarray(log_probs).argmax(axis=-1)
    out: list[int] = []
    prev = -1
    for i in ids.tolist():
        if i != prev and i != blank:
            out.append(i)
        prev = i
    return out


def edit_distance(a: list, b: list) -> int:
    """Levenshtein distance (substitution = deletion = insertion = 1)."""
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y))
        prev = cur
    return prev[-1]


def phoneme_error_rate(decoded: list, target: list) -> float:
    """edit_distance(decoded, target) / len(target). Can exceed 1 when the decode has many insertions."""
    if not target:
        raise ValueError("empty target")
    return edit_distance(decoded, target) / len(target)


def min_frames_needed(target_ids: list[int]) -> int:
    """CTC needs a blank between identical neighbours, so T >= L + (#adjacent repeats)."""
    return len(target_ids) + sum(1 for a, b in zip(target_ids, target_ids[1:]) if a == b)


def ctc_forced_align(log_probs: np.ndarray, target_ids: list[int], blank: int) -> list[list[int]] | None:
    """CTC Viterbi forced alignment of ``target_ids`` to ``log_probs`` (T, V).

    Trellis over the blank-extended sequence [b, t1, b, t2, ..., tL, b]. Returns, for each target token,
    the list of frames on which that token is emitted (>= 1 frame each), or None when the clip has too few
    frames for the target. Handles repeated phonemes (a blank is forced between identical neighbours) and
    the CTC blank (frames on blank states belong to no token).
    Written by hand instead of torchaudio.functional.forced_align (deprecated upstream, extra dependency).
    """
    lp = np.asarray(log_probs, dtype=np.float64)
    n_frames = lp.shape[0]
    n_tok = len(target_ids)
    if n_tok == 0 or n_frames < min_frames_needed(target_ids):
        return None
    ext = [blank]
    for t in target_ids:
        ext += [t, blank]
    n_states = len(ext)  # 2L+1
    ext_arr = np.array(ext)
    emit = lp[:, ext_arr]  # (T, S) emission score of each state at each frame

    neg = -np.inf
    score = np.full((n_frames, n_states), neg)
    back = np.zeros((n_frames, n_states), dtype=np.int8)  # 0: stay, 1: from s-1, 2: from s-2
    score[0, 0] = emit[0, 0]
    if n_states > 1:
        score[0, 1] = emit[0, 1]

    # skip transition s-2 -> s allowed only into a non-blank state whose label differs from label at s-2
    can_skip = np.zeros(n_states, dtype=bool)
    for s in range(2, n_states):
        can_skip[s] = ext[s] != blank and ext[s] != ext[s - 2]

    for t in range(1, n_frames):
        prev = score[t - 1]
        stay = prev
        step = np.concatenate(([neg], prev[:-1]))
        skip = np.concatenate(([neg, neg], prev[:-2]))
        skip = np.where(can_skip, skip, neg)
        stacked = np.stack([stay, step, skip])  # (3, S)
        best = stacked.argmax(axis=0)
        score[t] = stacked[best, np.arange(n_states)] + emit[t]
        back[t] = best

    # must end in the last blank or the last token
    end_state = n_states - 1 if score[-1, n_states - 1] >= score[-1, n_states - 2] else n_states - 2
    if not np.isfinite(score[-1, end_state]):
        return None
    path = np.zeros(n_frames, dtype=np.int64)
    s = end_state
    for t in range(n_frames - 1, -1, -1):
        path[t] = s
        s -= int(back[t, s])
    frames: list[list[int]] = [[] for _ in range(n_tok)]
    for t, st in enumerate(path.tolist()):
        if st % 2 == 1:
            frames[st // 2].append(t)
    if any(len(f) == 0 for f in frames):  # cannot happen for a feasible trellis; defensive
        return None
    return frames


def gop_per_phone(log_probs: np.ndarray, target_ids: list[int], frames: list[list[int]]) -> list[float]:
    """Per-phoneme GOP = ln posterior of the target phoneme at its best (peak) emitting frame, clamped to
    [GOP_FLOOR, 0]. Higher = better. Peak (not mean) because CTC spreads a phoneme over 1-3 frames and the
    boundary frames legitimately carry blank mass."""
    lp = np.asarray(log_probs, dtype=np.float64)
    out: list[float] = []
    for tid, fr in zip(target_ids, frames):
        out.append(float(min(0.0, max(GOP_FLOOR, lp[fr, tid].max()))))
    return out


def summarize_gops(gops: list[float], labels: list[str], bad_logp: float = BAD_PHONE_LOGP):
    """-> (gop_mean, gop_min, n_bad, bad_labels)."""
    bad = [lab for lab, g in zip(labels, gops) if g < bad_logp]
    return float(np.mean(gops)), float(np.min(gops)), len(bad), bad


def score_posteriors(
    log_probs: np.ndarray,
    id_to_label: list[str],
    blank: int,
    target_labels: list[str],
    bad_logp: float = BAD_PHONE_LOGP,
) -> dict | None:
    """Full pure scoring from a (T, V) log-posterior matrix. Returns a dict with the PhonemeScores numeric
    fields (per, gop_mean, gop_min, n_bad_phones, bad_phones, decoded, per_phone) or None if infeasible."""
    label_to_id = {lab: i for i, lab in enumerate(id_to_label)}
    if any(t not in label_to_id for t in target_labels):
        return None
    target_ids = [label_to_id[t] for t in target_labels]
    frames = ctc_forced_align(log_probs, target_ids, blank)
    if frames is None:
        return None
    gops = gop_per_phone(log_probs, target_ids, frames)
    mean, worst, n_bad, bad = summarize_gops(gops, target_labels, bad_logp)
    decoded_ids = ctc_greedy_decode(log_probs, blank)
    decoded = [id_to_label[i] for i in decoded_ids]
    return {
        "per": phoneme_error_rate(decoded, target_labels),
        "gop_mean": mean,
        "gop_min": worst,
        "n_bad_phones": n_bad,
        "bad_phones": bad,
        "decoded": " ".join(decoded),
        "per_phone": list(zip(target_labels, gops)),
    }


# ---------------------------------------------------------------------------------------------------
# Model handling (lazy torch / transformers)
# ---------------------------------------------------------------------------------------------------
_LOCK = threading.Lock()
_STATE: dict = {}  # "model", "labels", "blank", "torch"


def _env_true(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in _TRUE


def _deps_importable() -> bool:
    try:
        return all(importlib.util.find_spec(m) is not None for m in ("torch", "transformers"))
    except (ImportError, ValueError):  # e.g. sys.modules["torch"] = None
        return False


def phoneme_scoring_enabled() -> bool:
    """env PHONEME_SCORING is truthy AND torch + transformers are importable. Never raises."""
    try:
        return _env_true("PHONEME_SCORING") and _deps_importable()
    except Exception:  # pragma: no cover - defensive
        return False


def _load(local_only: bool = True):
    """Load (and cache) model + vocab. local_only=True never touches the network (use --download first)."""
    with _LOCK:
        if "model" in _STATE:
            return _STATE
        import json

        import torch
        from huggingface_hub import snapshot_download
        from transformers import Wav2Vec2ForCTC

        t0 = time.perf_counter()
        n_threads = int(os.getenv("PHONEME_THREADS", "0")) or min(4, os.cpu_count() or 1)
        torch.set_num_threads(n_threads)
        # Resolve to a local snapshot DIRECTORY so transformers makes no Hub calls at all (given a repo id it
        # still pings the Hub for safetensors-conversion PRs even with local_files_only=True).
        model_dir = snapshot_download(PHONEME_MODEL_ID, local_files_only=local_only)
        vocab_path = os.path.join(model_dir, "vocab.json")
        with open(vocab_path, encoding="utf-8") as fh:
            vocab: dict[str, int] = json.load(fh)
        labels = [""] * (max(vocab.values()) + 1)
        for tok, i in vocab.items():
            labels[i] = tok
        model = Wav2Vec2ForCTC.from_pretrained(model_dir)
        model.eval()
        blank = int(vocab.get("<pad>", model.config.pad_token_id or 0))
        _STATE.update(model=model, labels=labels, blank=blank, torch=torch, threads=n_threads)
        log.info("phoneme model loaded in %.1fs (threads=%d)", time.perf_counter() - t0, n_threads)
        return _STATE


def _resample(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    x = np.asarray(samples, dtype=np.float32).reshape(-1)
    if sample_rate != MODEL_SAMPLE_RATE:
        from math import gcd

        from scipy.signal import resample_poly

        g = gcd(int(sample_rate), MODEL_SAMPLE_RATE)
        x = resample_poly(x, MODEL_SAMPLE_RATE // g, int(sample_rate) // g).astype(np.float32)
    return x


def _log_posteriors(x16k: np.ndarray, st: dict) -> np.ndarray:
    torch = st["torch"]
    x = (x16k - x16k.mean()) / np.sqrt(x16k.var() + 1e-7)  # Wav2Vec2FeatureExtractor(do_normalize=True)
    with torch.inference_mode():
        logits = st["model"](torch.from_numpy(x).unsqueeze(0)).logits[0]
    return log_softmax(logits.float().numpy())


def warmup() -> None:
    """Load the model once (idempotent) and run a dummy inference. Never raises."""
    try:
        if not _deps_importable():
            return
        st = _load(local_only=True)
        rng = np.random.default_rng(0)
        _log_posteriors(rng.standard_normal(MODEL_SAMPLE_RATE).astype(np.float32) * 0.05, st)
    except Exception as exc:
        log.warning("phoneme warmup failed (%s: %s); run `python -m models.phoneme --download`",
                    type(exc).__name__, exc)


def score_phonemes(samples: np.ndarray, sample_rate: int, target_phrase: str) -> PhonemeScores | None:
    """Score articulation of ``samples`` (float32 mono in [-1, 1]) against ``target_phrase``.

    Returns None (never raises) when disabled, deps/model missing, phrase unknown, audio too short/silent,
    or any error."""
    try:
        if not phoneme_scoring_enabled():
            return None
        target = target_phonemes(target_phrase)
        if target is None:
            log.info("phoneme scoring: unknown phrase, skipping")
            return None
        t0 = time.perf_counter()
        x = _resample(samples, sample_rate)
        if not np.all(np.isfinite(x)):
            return None
        if len(x) / MODEL_SAMPLE_RATE < MIN_AUDIO_S or float(np.max(np.abs(x))) < MIN_PEAK:
            log.info("phoneme scoring: audio too short or silent")
            return None
        x = x[: int(MAX_AUDIO_S * MODEL_SAMPLE_RATE)]
        st = _load(local_only=True)
        lp = _log_posteriors(x, st)
        res = score_posteriors(lp, st["labels"], st["blank"], target)
        if res is None:
            log.info("phoneme scoring: alignment infeasible (clip too short for phrase)")
            return None
        return PhonemeScores(
            per=res["per"],
            gop_mean=res["gop_mean"],
            gop_min=res["gop_min"],
            n_bad_phones=res["n_bad_phones"],
            bad_phones=res["bad_phones"],
            decoded=res["decoded"],
            target=" ".join(target),
            duration_s=len(x) / MODEL_SAMPLE_RATE,
            elapsed_s=time.perf_counter() - t0,
            per_phone=res["per_phone"],
            model=PHONEME_MODEL_ID,
        )
    except Exception as exc:
        log.warning("phoneme scoring failed (%s)", type(exc).__name__)  # type only: keep audio-derived text out of logs
        return None


# ---------------------------------------------------------------------------------------------------
# CLI: python -m models.phoneme --download | --check
# ---------------------------------------------------------------------------------------------------
def _cached_size_mb() -> float | None:
    try:
        from huggingface_hub import snapshot_download

        p = snapshot_download(PHONEME_MODEL_ID, local_files_only=True)
    except Exception:
        return None
    total = 0
    for root, _, files in os.walk(p):
        for f in files:
            total += os.path.getsize(os.path.join(root, f))  # follows symlinks into blobs
    return total / 1e6


def model_cached() -> bool:
    """True when the model is fully in the local HF cache (no network access)."""
    return _cached_size_mb() is not None


def _smoke() -> None:
    rng = np.random.default_rng(0)
    t = np.arange(int(5 * MODEL_SAMPLE_RATE)) / MODEL_SAMPLE_RATE
    audio = (0.1 * np.sin(2 * np.pi * 150 * t) + 0.02 * rng.standard_normal(t.size)).astype(np.float32)
    phrase = "You can't teach an old dog new tricks."
    os.environ["PHONEME_SCORING"] = "true"
    t0 = time.perf_counter()
    _load(local_only=True)
    print(f"cold load: {time.perf_counter() - t0:.2f}s")
    for i in range(3):
        r = score_phonemes(audio, MODEL_SAMPLE_RATE, phrase)
        print(f"run {i}: {'None' if r is None else f'per={r.per:.2f} gop_mean={r.gop_mean:.2f} elapsed={r.elapsed_s:.2f}s'}")
    print("(synthetic tone, output is garbage by design; only the plumbing and timing matter)")


def main(argv: list[str] | None = None) -> int:
    import argparse

    ap = argparse.ArgumentParser(prog="python -m models.phoneme", description=__doc__.splitlines()[0])
    ap.add_argument("--download", action="store_true", help="download + cache the model, then smoke test")
    ap.add_argument("--check", nargs="?", const="", metavar="PHRASE",
                    help="report deps/cache state (optionally validate a phrase's phonemes vs the vocab)")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    print(f"model: {PHONEME_MODEL_ID}")
    print(f"torch+transformers importable: {_deps_importable()}")
    if not _deps_importable():
        print("install: pip install torch --index-url https://download.pytorch.org/whl/cpu && "
              "pip install -r requirements-ml.txt")
        return 1
    if args.download:
        from huggingface_hub import snapshot_download

        snapshot_download(PHONEME_MODEL_ID)
    size = _cached_size_mb()
    print(f"cached: {'no' if size is None else f'yes, {size:.0f} MB'}")
    if size is None:
        print("run: python -m models.phoneme --download")
        return 1
    if args.check:
        tgt = target_phonemes(args.check)
        if tgt is None:
            print("phrase unknown: add it to TARGET_PHONEMES")
            return 1
        labels = _load()["labels"]
        missing = [p for p in tgt if p not in labels]
        print(f"target: {' '.join(tgt)}  missing from vocab: {missing or 'none'}")
        return 1 if missing else 0
    _smoke()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
