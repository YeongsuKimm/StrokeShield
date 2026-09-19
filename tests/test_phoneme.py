"""Tests for models/phoneme.py. Pure math is tested with synthetic posterior matrices (no torch needed).
Real-model tests are skipped unless torch + transformers are importable AND the model is already in the
local HF cache (they never download; run `python -m models.phoneme --download` first)."""

from __future__ import annotations

import math
import subprocess
import sys

import numpy as np
import pytest

from models import phoneme as P

LABELS = ["<pad>", "<unk>", "k", "ae", "n", "t", "iy", "ch", "aa", "g", "s"]
BLANK = 0
ID = {lab: i for i, lab in enumerate(LABELS)}
V = len(LABELS)
PHRASE = "You can't teach an old dog new tricks."


def make_lp(plan: list[str | None], peak: float = 0.95, noise_seed: int = 0) -> np.ndarray:
    """One frame per plan entry: a label name (that label has prob `peak`) or None (blank has prob `peak`)."""
    rng = np.random.default_rng(noise_seed)
    rows = []
    for item in plan:
        p = rng.random(V) * 1e-3 + 1e-4
        p[ID["<unk>"]] = 1e-6
        p[BLANK if item is None else ID[item]] = 0.0
        p = p / p.sum() * (1 - peak)
        p[BLANK if item is None else ID[item]] = peak
        rows.append(np.log(p / p.sum()))
    return np.array(rows)


def spread(phones: list[str | None], blanks: int = 2) -> list[str | None]:
    """phone sequence -> frame plan with `blanks` blank frames around each phone (CTC peaky style)."""
    plan: list[str | None] = [None] * blanks
    for ph in phones:
        plan += [ph] + [None] * blanks
    return plan


# ------------------------------------------------------------------ pure math
def test_normalize_phrase_and_lookup():
    assert P.normalize_phrase("  You can't   TEACH an old dog, new tricks! ") == "you cant teach an old dog new tricks"
    assert P.normalize_phrase("You can’t teach an old dog new tricks.") == "you cant teach an old dog new tricks"
    for phrase in ("Nothing beats a jolly good breakfast.", "They heard him speak on the radio last night."):
        assert P.target_phonemes(phrase)
    assert P.target_phonemes("completely unknown phrase") is None
    assert P.target_phonemes(PHRASE)[:3] == ["y", "uw", "k"]


def test_greedy_decode_collapses_repeats_and_drops_blank():
    lp = make_lp([None, "k", "k", None, "k", "ae", "ae", None, None, "n"])
    # k k -> k, blank separates a genuine repeated k, ae ae -> ae
    assert P.ctc_greedy_decode(lp, BLANK) == [ID["k"], ID["k"], ID["ae"], ID["n"]]
    assert P.ctc_greedy_decode(make_lp([None, None]), BLANK) == []


def test_edit_distance_and_per():
    assert P.edit_distance([], []) == 0
    assert P.edit_distance(list("abc"), list("abc")) == 0
    assert P.edit_distance(list("abc"), list("abd")) == 1  # substitution
    assert P.edit_distance(list("abc"), list("ac")) == 1  # deletion
    assert P.edit_distance(list("ac"), list("abc")) == 1  # insertion
    assert P.edit_distance(list("kitten"), list("sitting")) == 3
    assert P.phoneme_error_rate(list("abcd"), list("abcd")) == 0.0
    assert P.phoneme_error_rate(list("abxd"), list("abcd")) == pytest.approx(0.25)
    assert P.phoneme_error_rate(list("abcdefgh"), list("ab")) == pytest.approx(3.0)  # can exceed 1
    with pytest.raises(ValueError):
        P.phoneme_error_rate(["a"], [])


def test_log_softmax_normalizes():
    out = P.log_softmax(np.array([[1000.0, 1000.0], [0.0, -1000.0]]))  # would overflow a naive softmax
    assert np.allclose(np.exp(out).sum(axis=-1), 1.0)
    assert out[0, 0] == pytest.approx(math.log(0.5))


def test_perfect_alignment():
    target = ["k", "ae", "n", "t"]
    lp = make_lp(spread(target))
    frames = P.ctc_forced_align(lp, [ID[t] for t in target], BLANK)
    assert frames is not None and [len(f) for f in frames] == [1, 1, 1, 1]
    assert frames == sorted(frames)
    res = P.score_posteriors(lp, LABELS, BLANK, target)
    assert res["per"] == 0.0
    assert res["gop_mean"] > math.log(0.9)
    assert res["n_bad_phones"] == 0 and res["bad_phones"] == []
    assert res["decoded"] == "k ae n t"
    assert [p for p, _ in res["per_phone"]] == target


def test_substituted_phoneme_is_flagged():
    target = ["k", "ae", "n", "t", "iy", "ch"]
    spoken = ["k", "ae", "n", "s", "iy", "ch"]  # t -> s
    res = P.score_posteriors(make_lp(spread(spoken)), LABELS, BLANK, target)
    assert res["per"] == pytest.approx(1 / 6)
    assert res["bad_phones"] == ["t"]
    assert res["n_bad_phones"] == 1
    assert res["gop_min"] < math.log(0.05)
    assert res["gop_mean"] < P.score_posteriors(make_lp(spread(target)), LABELS, BLANK, target)["gop_mean"]
    assert "s" in res["decoded"].split() and "t" not in res["decoded"].split()


def test_deleted_phoneme_is_flagged():
    target = ["k", "ae", "n", "t", "iy", "ch"]
    spoken = ["k", "ae", "t", "iy", "ch"]  # n dropped
    res = P.score_posteriors(make_lp(spread(spoken)), LABELS, BLANK, target)
    assert res["per"] == pytest.approx(1 / 6)
    assert res["n_bad_phones"] >= 1
    assert "n" in res["bad_phones"]
    assert res["gop_min"] < math.log(0.05)


def test_repeated_phonemes_need_a_blank_between():
    target = ["n", "n", "ae"]
    ids = [ID[t] for t in target]
    assert P.min_frames_needed(ids) == 4
    # n, blank, n, ae : feasible and both n's score well
    lp = make_lp(["n", None, "n", "ae"])
    frames = P.ctc_forced_align(lp, ids, BLANK)
    assert frames == [[0], [2], [3]]
    res = P.score_posteriors(lp, LABELS, BLANK, target)
    assert res["per"] == 0.0 and res["n_bad_phones"] == 0
    # a single sustained n (no blank) decodes to ONE n -> PER 1/3, and the repeat is not silently accepted
    res2 = P.score_posteriors(make_lp(["n", "n", "n", "ae", "ae"]), LABELS, BLANK, target)
    assert res2["decoded"] == "n ae"
    assert res2["per"] == pytest.approx(1 / 3)
    # too few frames for the repeat -> infeasible
    assert P.ctc_forced_align(make_lp(["n", "n", "ae"]), ids, BLANK) is None


def test_blank_frames_never_assigned_to_tokens_and_alignment_is_monotonic():
    target = ["k", "ae", "n"]
    plan = [None] * 7 + ["k"] + [None] * 5 + ["ae"] + [None] * 9 + ["n"] + [None] * 4
    lp = make_lp(plan)
    frames = P.ctc_forced_align(lp, [ID[t] for t in target], BLANK)
    peaks = [plan.index("k"), plan.index("ae"), plan.index("n")]
    for fr, pk in zip(frames, peaks):
        assert pk in fr
    flat = [f for fr in frames for f in fr]
    assert flat == sorted(flat) and len(flat) == len(set(flat))


def test_infeasible_or_degenerate_inputs():
    assert P.ctc_forced_align(make_lp([None, None]), [ID["k"], ID["ae"], ID["n"]], BLANK) is None
    assert P.ctc_forced_align(make_lp([None, None, None]), [], BLANK) is None
    assert P.score_posteriors(make_lp(spread(["k"])), LABELS, BLANK, ["zz"]) is None  # phone not in vocab


def test_gop_is_clamped_to_floor():
    lp = np.full((6, V), -50.0)
    lp[:, BLANK] = 0.0
    frames = P.ctc_forced_align(lp, [ID["k"], ID["ae"]], BLANK)
    gops = P.gop_per_phone(lp, [ID["k"], ID["ae"]], frames)
    assert gops == [P.GOP_FLOOR, P.GOP_FLOOR]


def test_hardcoded_targets_are_well_formed():
    for key, seq in P.TARGET_PHONEMES.items():
        assert key == P.normalize_phrase(key)
        phones = seq.split()
        assert len(phones) > 10
        assert all(a != b for a, b in zip(phones, phones[1:])), f"unmerged geminate in {key}"
        assert all(p.isalpha() and p.islower() and p != "ao" for p in phones)  # TIMIT-39: no 'ao'


# ------------------------------------------------------------------ public API guards
def _audio(seconds: float = 3.0, sr: int = 16000) -> np.ndarray:
    t = np.arange(int(seconds * sr)) / sr
    return (0.2 * np.sin(2 * np.pi * 180 * t)).astype(np.float32)


def test_flag_off_returns_none(monkeypatch):
    monkeypatch.delenv("PHONEME_SCORING", raising=False)
    assert P.phoneme_scoring_enabled() is False
    assert P.score_phonemes(_audio(), 16000, PHRASE) is None
    monkeypatch.setenv("PHONEME_SCORING", "false")
    assert P.score_phonemes(_audio(), 16000, PHRASE) is None


def test_torch_missing_returns_none_without_raising(monkeypatch):
    monkeypatch.setenv("PHONEME_SCORING", "true")
    monkeypatch.setitem(sys.modules, "torch", None)  # `import torch` now raises ImportError
    monkeypatch.setitem(sys.modules, "transformers", None)
    assert P.phoneme_scoring_enabled() is False
    assert P.score_phonemes(_audio(), 16000, PHRASE) is None
    P.warmup()  # must not raise


def test_import_and_pure_functions_work_without_torch():
    code = (
        "import sys; sys.modules['torch']=None; sys.modules['transformers']=None;"
        "import numpy as np; from models import phoneme as P;"
        "assert P.edit_distance(list('ab'), list('b'))==1;"
        "assert P.score_phonemes(np.zeros(16000, np.float32), 16000, 'x') is None"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr


@pytest.fixture
def fake_model(monkeypatch):
    """Enable the flag and replace the network model with a fake that 'hears' exactly the target phrase
    (or a supplied plan), so the whole score_phonemes plumbing runs without torch."""
    monkeypatch.setenv("PHONEME_SCORING", "true")
    monkeypatch.setattr(P, "_deps_importable", lambda: True)
    monkeypatch.setattr(P, "_load", lambda local_only=True: {"labels": LABELS, "blank": BLANK})
    state = {"plan": None, "seen_len": None}

    def fake_lp(x16k, st):
        state["seen_len"] = len(x16k)
        return make_lp(state["plan"])

    monkeypatch.setattr(P, "_log_posteriors", fake_lp)
    monkeypatch.setitem(P.TARGET_PHONEMES, "test phrase", "k ae n t iy ch")
    return state


def test_score_phonemes_plumbing_with_fake_model(fake_model):
    fake_model["plan"] = spread(["k", "ae", "n", "t", "iy", "ch"])
    r = P.score_phonemes(_audio(3.0, 44100), 44100, "Test phrase.")  # 44.1 kHz input is resampled
    assert isinstance(r, P.PhonemeScores)
    assert fake_model["seen_len"] == 3 * 16000
    assert r.per == 0.0 and r.n_bad_phones == 0 and r.bad_phones == []
    assert r.target == "k ae n t iy ch" and r.decoded == r.target
    assert r.duration_s == pytest.approx(3.0)
    assert r.elapsed_s >= 0 and len(r.per_phone) == 6

    fake_model["plan"] = spread(["k", "ae", "n", "s", "iy", "ch"])
    bad = P.score_phonemes(_audio(), 16000, "test phrase")
    assert bad.per > 0 and bad.bad_phones == ["t"] and bad.gop_mean < r.gop_mean


def test_unknown_phrase_returns_none(fake_model):
    fake_model["plan"] = spread(["k"])
    assert P.score_phonemes(_audio(), 16000, "this is not a known phrase") is None


def test_audio_too_short_or_silent_returns_none(fake_model):
    fake_model["plan"] = spread(["k", "ae", "n", "t", "iy", "ch"])
    assert P.score_phonemes(_audio(0.2), 16000, "test phrase") is None
    assert P.score_phonemes(np.zeros(3 * 16000, np.float32), 16000, "test phrase") is None
    assert P.score_phonemes(np.full(3 * 16000, np.nan, np.float32), 16000, "test phrase") is None
    assert P.score_phonemes(np.array([], np.float32), 16000, "test phrase") is None


def test_clip_too_short_for_phrase_returns_none(fake_model):
    fake_model["plan"] = [None, "k", None]  # 3 frames < 6 phones
    assert P.score_phonemes(_audio(), 16000, "test phrase") is None


def test_internal_error_returns_none(fake_model, monkeypatch):
    def boom(x, st):
        raise RuntimeError("model exploded")

    monkeypatch.setattr(P, "_log_posteriors", boom)
    assert P.score_phonemes(_audio(), 16000, "test phrase") is None


# ------------------------------------------------------------------ real model (skipped unless cached)
real_model = pytest.mark.skipif(
    not (P._deps_importable() and P.model_cached()),
    reason="torch/transformers or the cached phoneme model are unavailable (python -m models.phoneme --download)",
)


@real_model
def test_real_model_smoke_on_synthetic_audio(monkeypatch):
    monkeypatch.setenv("PHONEME_SCORING", "true")
    P.warmup()
    rng = np.random.default_rng(0)
    x = _audio(4.0) + (0.02 * rng.standard_normal(4 * 16000)).astype(np.float32)
    r = P.score_phonemes(x, 16000, PHRASE)
    assert r is not None  # a tone is garbage input, but the plumbing must return a full result
    assert r.per > 0.5  # a tone is definitely not the phrase
    assert P.GOP_FLOOR <= r.gop_min <= r.gop_mean <= 0.0
    assert r.target == " ".join(P.target_phonemes(PHRASE))
    assert 3.9 < r.duration_s < 4.1
