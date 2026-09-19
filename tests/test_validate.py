"""Tests for the speech validation tool. No real audio and no DSP stack: tiny generated WAVs + a fake analyzer."""
import io
import json
import math
import re
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
import pytest

from backend.schemas import TestResult
from models import config
from models import validate as v

REPO_ROOT = Path(__file__).resolve().parents[1]
RETRY_FRAMES = 50
CLOSING = "Mimicked deficits are not real stroke patients: this validates screening-heuristic behaviour on volunteers, not clinical accuracy."


# ---------- fixtures / helpers ----------

def write_wav(path: Path, severity: float | None) -> Path:
    """Tiny WAV whose length encodes the severity the fake analyzer reports (None = retry)."""
    n = RETRY_FRAMES if severity is None else 100 + int(round(severity * 1000))
    samples = (np.sin(np.linspace(0, 200, n)) * 3000).astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(samples.tobytes())
    return path


CALLS: list[int] = []


def fake_analyzer(wav: bytes, phrase: str) -> TestResult:
    with wave.open(io.BytesIO(wav)) as w:
        n = w.getnframes()
    CALLS.append(n)
    base = dict(test="speech", started_at=0, duration_ms=1)
    if n == RETRY_FRAMES:
        return TestResult(severity=0, confidence=0, flags=["too quiet, please speak louder"], needs_retry=True, **base)
    sev = (n - 100) / 1000
    return TestResult(severity=sev, confidence=0.9, metrics={"hnr_db": 20 - 10 * sev, "noise": 1.0}, flags=["x"], **base)


def add_clip(root: Path, subject: str, expected: str, sev: float | None, i: int, scenario: str = "sc", **extra: object) -> Path:
    wav = write_wav(root / f"{subject}__{scenario}__{i:03d}.wav", sev)
    body = {"schema": 1, "kind": "speech", "subject": subject, "scenario": scenario, "expected": expected, **extra}
    wav.with_suffix(".json").write_text(json.dumps(body))
    return wav


def run_main(argv: list[str], analyzer=fake_analyzer) -> tuple[int, str]:
    out = io.StringIO()
    code = v.main(argv, analyzer=analyzer, out=out)
    return code, out.getvalue()


def mk(expected: str, sev: float, conf: float = 0.9, retry: bool = False, split: str = "validate", **kw) -> v.Run:
    return v.Run(path=Path("x.wav"), subject="s", split=split, scenario="sc", expected=expected,
                 severity=math.nan if retry else sev, confidence=math.nan if retry else conf, retry=retry,
                 retry_reason="too quiet" if retry else "", **kw)


def crit(runs, name: str) -> v.Criterion:
    return next(c for c in v.criteria(runs) if c.name == name)


# ---------- split ----------

@pytest.mark.parametrize("name,bucket,split", [
    ("sam", 66, "validate"), ("alex", 43, "tune"), ("jo", 67, "validate"), ("Sam ", 66, "validate"), ("anon", 53, "tune"),
    ("maria", 72, "validate"), ("li", 60, "validate"), ("omar", 25, "tune"), ("priya", 49, "tune"), ("tom", 40, "tune"),
])
def test_split_vectors(name, bucket, split):
    assert v.bucket_for(name) == bucket
    assert v.split_for(name) == split


def test_split_is_deterministic_and_case_and_whitespace_insensitive():
    assert v.split_for("  SAM") == v.split_for("sam") == v.split_for("Sam")


def test_override_wins_and_is_normalized():
    ov = v.parse_split_override({"tune": ["Sam "], "validate": ["ALEX"]})
    assert v.split_for("sam", ov) == "tune"  # hash says validate
    assert v.split_for("alex", ov) == "validate"  # hash says tune
    assert v.split_for("omar", ov) == "tune"  # not listed: hash


def test_override_conflict_and_bad_shapes_raise():
    with pytest.raises(v.SplitError, match="both"):
        v.parse_split_override({"tune": ["a", "B"], "validate": [" b"]})
    for bad in ([], {"train": ["a"]}, {"tune": "a"}, {"tune": [1]}):
        with pytest.raises(v.SplitError):
            v.parse_split_override(bad)


# ---------- statistics ----------

def test_wilson_vectors():
    assert v.wilson(0, 60, 1.645)[1] == pytest.approx(0.0432, abs=5e-5)
    assert v.wilson(0, 20, 1.645)[1] == pytest.approx(0.1192, abs=5e-5)
    lo, hi = v.wilson(54, 60, 1.96)
    assert (round(lo, 4), round(hi, 4)) == (0.7985, 0.9534)
    lo, hi = v.wilson(9, 10, 1.96)
    assert (round(lo, 4), round(hi, 4)) == (0.5958, 0.9821)
    lo, hi = v.wilson(60, 60, 1.96)
    assert round(lo, 4) == 0.9398 and hi == pytest.approx(1.0) and hi <= 1.0
    assert v.wilson(0, 60, 1.645)[0] == 0.0


def test_wilson_n0_is_nan():
    lo, hi = v.wilson(0, 0)
    assert math.isnan(lo) and math.isnan(hi)


def test_percentile_median_auc_d():
    assert v.percentile([1, 2, 3, 4], 50) == 2.5 == v.median([4, 1, 3, 2])
    assert v.percentile([1, 2, 3, 4, 5], 90) == pytest.approx(4.6)
    assert v.percentile([1, 2, 3, 4, 5], 10) == pytest.approx(1.4)
    assert v.percentile([7], 90) == 7 and math.isnan(v.percentile([], 50))
    assert v.auc([1, 2], [3, 4]) == 1.0 and v.auc([3, 4], [1, 2]) == 0.0 and v.auc([1, 2], [1, 2]) == 0.5
    assert v.cohens_d([1, 2, 3], [3, 4, 5]) == pytest.approx(2.0)


# ---------- criteria ----------

def healthy(n: int, alerts: int = 0, sev: float = 0.05) -> list[v.Run]:
    return [mk("healthy", 1.0, conf=1.0) for _ in range(alerts)] + [mk("healthy", sev) for _ in range(n - alerts)]


def test_false_alarm_boundaries():
    c = crit(healthy(60), "falseAlarm")
    assert c.status == v.PASS and (c.k, c.n) == (0, 60) and c.hi == pytest.approx(0.0432, abs=5e-5)
    c = crit(healthy(20), "falseAlarm")
    assert c.status == v.INSUFFICIENT and c.hi == pytest.approx(0.1192, abs=5e-5)
    assert "needs 40 more" in c.detail
    assert "needs 1 more" in crit(healthy(59), "falseAlarm").detail
    c = crit(healthy(60, alerts=2), "falseAlarm")
    assert c.status == v.FAIL and (c.k, c.n) == (2, 60)


def test_false_alarm_retries_are_excluded():
    runs = healthy(60) + [mk("healthy", 0, retry=True) for _ in range(30)]
    assert crit(runs, "falseAlarm").n == 60


def test_speech_alone_alert_needs_severity_times_confidence_one():
    assert not mk("healthy", 0.99, conf=1.0).alert and mk("healthy", 1.0, conf=1.0).alert


def test_healthy_anchor_boundaries():
    def runs(ok, n):
        return [mk("healthy", 0.15) for _ in range(ok)] + [mk("healthy", 0.16) for _ in range(n - ok)]
    assert crit(runs(19, 20), "healthyAnchor").status == v.PASS  # exactly 95 %
    assert crit(runs(18, 20), "healthyAnchor").status == v.FAIL
    c = crit(runs(19, 19), "healthyAnchor")
    assert c.status == v.INSUFFICIENT and math.isfinite(c.lo) and math.isfinite(c.hi)


def test_deficit_detection_boundaries():
    def runs(ok, n):
        return [mk("deficit", 0.85) for _ in range(ok)] + [mk("deficit", 0.84) for _ in range(n - ok)]
    assert crit(runs(18, 20), "deficitDetection").status == v.PASS  # exactly 90 %
    assert crit(runs(17, 20), "deficitDetection").status == v.FAIL
    assert crit(runs(19, 19), "deficitDetection").status == v.INSUFFICIENT


def test_retry_rate_boundaries():
    def runs(retries, n):
        return [mk("healthy", 0, retry=True) for _ in range(retries)] + [mk("healthy", 0.05) for _ in range(n - retries)]
    assert crit(runs(4, 20), "retryRate").status == v.PASS  # exactly 20 %
    assert crit(runs(5, 20), "retryRate").status == v.FAIL
    assert crit(runs(0, 19), "retryRate").status == v.INSUFFICIENT


def test_borderline_no_alert():
    ok = [mk("borderline", 0.35) for _ in range(5)]
    assert crit(ok, "borderlineNoAlert").status == v.PASS
    assert crit(ok[:4], "borderlineNoAlert").status == v.INSUFFICIENT
    assert crit(ok + [mk("borderline", 1.0, conf=1.0)], "borderlineNoAlert").status == v.FAIL


def test_no_data_is_insufficient_never_pass():
    crits = v.criteria([])
    assert [c.status for c in crits] == [v.INSUFFICIENT] * 5
    assert v.overall(crits) == v.INSUFFICIENT
    assert v.overall([v.Criterion("a", v.PASS, 1, 1, 1, 1, 1, "two-sided", ""), v.Criterion("b", v.FAIL, 0, 1, 0, 0, 0, "two-sided", "")]) == v.FAIL


# ---------- breakdowns ----------

def test_condition_breakdown_by_noise_and_mic():
    runs = ([mk("healthy", 0.05, conditions={"noise": "quiet", "mic": "laptop"}) for _ in range(12)]
            + [mk("healthy", 0.05, conditions={"noise": "loud", "mic": "laptop"}) for _ in range(3)]
            + [mk("healthy", 0.30, conditions={"noise": "loud", "mic": "headset"}) for _ in range(2)]
            + [mk("healthy", 0.05)]  # old sidecar: no conditions -> unspecified
            + [mk("deficit", 0.9, conditions={"noise": "quiet"})])
    groups = {(g.key, g.value): g for g in v.condition_breakdown(runs)}
    quiet, loud = groups[("noise", "quiet")], groups[("noise", "loud")]
    assert (quiet.healthy_n, quiet.healthy_ok, quiet.deficit_n, quiet.deficit_hit) == (12, 12, 1, 1)
    assert quiet.warning == ""
    assert (loud.healthy_n, loud.healthy_ok) == (5, 3) and "n<10" in loud.warning
    assert groups[("mic", "headset")].healthy_ok == 0
    assert groups[("noise", "unspecified")].healthy_n == 1
    assert ("nativeEnglish", "unspecified") in groups and ("device", "unspecified") in groups
    assert not any(k[0] in ("glasses", "lighting") for k in groups)  # vision keys ignored


def test_native_english_bool_and_device_values():
    runs = [mk("healthy", 0.05, conditions={"nativeEnglish": False, "device": "MacBook"}), mk("healthy", 0.05, conditions={"nativeEnglish": True})]
    groups = {(g.key, g.value) for g in v.condition_breakdown(runs)}
    assert {("nativeEnglish", "false"), ("nativeEnglish", "true"), ("device", "MacBook")} <= groups


# ---------- ramp suggestions ----------

def metric_runs(expected: str, values, name="hnr_db") -> list[v.Run]:
    return [mk(expected, 0.5, split="tune", metrics={name: x}) for x in values]


def test_ramp_lower_is_worse_and_edges():
    healthy_v = [20, 21, 22, 23, 24]
    deficit_v = [5, 6, 7, 8, 9]
    (s,) = v.ramp_suggestions(metric_runs("healthy", healthy_v) + metric_runs("deficit", deficit_v))
    assert s.direction == "lower is worse"
    assert s.normal_edge == pytest.approx(v.percentile(healthy_v, 10)) and s.abnormal_edge == 7
    assert s.auc == 0.0 and s.label == "strong" and s.useful
    assert s.current == (18.0, 8.0) and not s.wrong_way  # current hnr ramp already points the right way


def test_ramp_higher_is_worse_uses_p90():
    (s,) = v.ramp_suggestions(metric_runs("healthy", [0.1, 0.2, 0.3, 0.4, 0.5], "cer") + metric_runs("deficit", [0.6, 0.7, 0.8, 0.9, 1.0], "cer"))
    assert s.direction == "higher is worse" and s.normal_edge == pytest.approx(0.46) and s.abnormal_edge == 0.8
    assert s.auc == 1.0 and s.label == "strong" and not s.wrong_way


def test_ramp_wrong_way_when_config_contradicts_data():
    # hnr_db ramp is (18 -> 8): LOW is bad. Data where impaired HNR is HIGHER contradicts it.
    (s,) = v.ramp_suggestions(metric_runs("healthy", [5, 6, 7, 8, 9]) + metric_runs("deficit", [20, 21, 22, 23, 24]))
    assert s.direction == "higher is worse" and s.wrong_way and s.current == (18.0, 8.0)
    text = v.render_full(_ctx_for_ramps(metric_runs("healthy", [5, 6, 7, 8, 9]) + metric_runs("deficit", [20, 21, 22, 23, 24])))
    assert "WRONG WAY" in text


def test_ramp_overlap_says_no_useful_separation_and_unknown_metric_has_no_current():
    h = [1, 2, 3, 4, 10]
    d = [1.5, 2.5, 3.5, 2, 2.2]
    (s,) = v.ramp_suggestions(metric_runs("healthy", h, "made_up") + metric_runs("deficit", d, "made_up"))
    assert not s.useful and "no useful separation" in s.note and s.current is None


def test_ramp_needs_data_and_ignores_validate_and_retries():
    (s,) = v.ramp_suggestions(metric_runs("healthy", [1]) + metric_runs("deficit", [2, 3]))
    assert "insufficient" in s.note and not s.direction
    validate_only = [mk("healthy", 0.5, split="validate", metrics={"cer": 1.0}) for _ in range(5)]
    retries = [mk("deficit", 0, retry=True, split="tune", metrics={"cer": 9.0}) for _ in range(5)]
    assert v.ramp_suggestions(retries) == []
    assert v.ramp_suggestions([r for r in validate_only if r.split == "tune"]) == []


# ---------- sweep ----------

def test_sweep_is_monotone_non_increasing_and_counts():
    tune = [mk("healthy", s, split="tune") for s in (0.05, 0.12, 0.3, 0.6)] + [mk("deficit", s, split="tune") for s in (0.5, 0.9, 1.0)]
    val = [mk("healthy", 0.9), mk("deficit", 0.2), mk("deficit", 0, retry=True)]
    rows = v.sweep(tune, val)
    assert [r.cutoff for r in rows][0] == 0.10 and rows[-1].cutoff == 0.95 and len(rows) == 18
    for field_name in ("tune_healthy", "tune_deficit", "validate_healthy", "validate_deficit"):
        ks = [getattr(r, field_name)[0] for r in rows]
        assert ks == sorted(ks, reverse=True)
    at = {r.cutoff: r for r in rows}
    assert at[0.15].tune_healthy == (2, 4) and at[0.85].tune_deficit == (2, 3) and at[0.15].validate_deficit == (1, 1)
    assert v.sweep(None, val)[0].tune_healthy is None


# ---------- freeze ----------

def test_freeze_status_transitions(tmp_path, monkeypatch):
    path = tmp_path / "sub" / "frozen-speech.json"
    st = v.freeze_status(path)
    assert st.state == "none" and st.text.startswith("Thresholds frozen: NO freeze file")

    payload = v.write_freeze(path, commit="abcdef1234567890")
    assert path.is_file() and set(payload) >= {"frozenAt", "gitCommit", "hash", "config"}
    assert len(payload["hash"]) == 16 and payload["hash"] == v.freeze_hash()
    assert json.loads(path.read_text())["hash"] == payload["hash"]
    st = v.freeze_status(path)
    assert st.state == "yes"
    assert st.text.startswith("Thresholds frozen: YES (hash matches, frozen ") and "at abcdef1" in st.text

    monkeypatch.setattr(config, "MIN_SNR_DB", 3.0)
    st = v.freeze_status(path)
    assert st.state == "changed" and "NOT independent evidence" in st.text
    assert f"frozen {payload['hash']} vs current {v.freeze_hash()}" in st.text
    assert payload["hash"] != v.freeze_hash()


def test_freeze_hash_covers_config_dict_and_phoneme_constants(monkeypatch):
    from models import phoneme

    base = v.freeze_hash()
    assert v.freeze_hash() == base
    monkeypatch.setitem(config.RAMPS, "cer", (0.2, 0.5))
    changed_ramp = v.freeze_hash()
    assert changed_ramp != base
    monkeypatch.setattr(phoneme, "GOP_FLOOR", -9.0)
    assert v.freeze_hash() != changed_ramp
    cfg = v.freeze_config()
    assert "RAMPS" in cfg["config"] and "GOP_FLOOR" in cfg["phoneme"] and "TARGET_PHONEMES" in cfg["phoneme"]
    assert isinstance(cfg["config"]["RAMPS"]["cer"], list)  # tuples become arrays


def test_freeze_hash_is_order_independent():
    assert v.freeze_hash({"a": {"y": 1, "x": (1, 2)}, "b": 2}) == v.freeze_hash({"b": 2, "a": {"x": [1, 2], "y": 1}})


def test_unreadable_freeze_file_counts_as_missing(tmp_path):
    p = tmp_path / "f.json"
    p.write_text("{nope")
    assert v.freeze_status(p).state == "none"


def test_import_does_not_load_torch():
    code = "import sys, models.validate; assert 'torch' not in sys.modules; assert 'transformers' not in sys.modules"
    res = subprocess.run([sys.executable, "-c", code], cwd=REPO_ROOT, capture_output=True, text=True)
    assert res.returncode == 0, res.stderr


# ---------- end to end ----------

VALIDATE_SUBJECTS = ["sam", "jo", "maria", "li"]
TUNE_SUBJECTS = ["alex", "anon", "omar", "priya", "tom"]


def build_dataset(root: Path, healthy_sev: float = 0.05, per_subject: int = 5, retries: int = 0) -> None:
    i = 0
    for subj in VALIDATE_SUBJECTS + TUNE_SUBJECTS:
        for _ in range(per_subject):
            i += 1
            add_clip(root, subj, "healthy", healthy_sev, i, "speech-normal",
                     conditions={"noise": "quiet" if (i // 2) % 2 else "loud", "mic": "laptop", "nativeEnglish": True},
                     env={"sampleRate": 16000, "echoCancellation": False, "userAgent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537"})
            i += 1
            add_clip(root, subj, "deficit", 0.95, i, "speech-mimic-slurred")
        for _ in range(retries):
            i += 1
            add_clip(root, subj, "healthy", None, i, "speech-normal")


def argv(root: Path, *extra: str) -> list[str]:
    return ["--dir", str(root), "--freeze-file", str(root / "none.json"), *extra]


@pytest.fixture(autouse=True)
def _clear_calls():
    CALLS.clear()


def test_validate_mode_only_analyzes_validation_subjects(tmp_path):
    build_dataset(tmp_path)
    code, text = run_main(argv(tmp_path, "--mode", "validate"))
    assert len(CALLS) == 4 * 10  # validate subjects only: 4 subjects x (5 healthy + 5 deficit)
    assert code == 0  # insufficient (n=20 healthy < 60 for falseAlarm) is loud but not a failure
    assert "INSUFFICIENT DATA" in text and "needs 40 more" in text
    assert "Mode: validate" in text and "Thresholds frozen: NO freeze file" in text
    assert "healthyAnchor" in text and "PASS" in text
    assert "Ramp suggestions" in text and "Not computed in validate mode" in text
    assert text.rstrip().endswith(CLOSING)


def test_validate_exit_1_when_a_criterion_fails(tmp_path):
    build_dataset(tmp_path, healthy_sev=0.5)
    code, text = run_main(argv(tmp_path))
    assert code == 1 and "FAIL" in text and "Failing runs" in text
    assert str(tmp_path) in text  # full rendering names the files


def test_tune_mode_has_no_pass_fail_but_has_ramps_and_sweep(tmp_path):
    build_dataset(tmp_path)
    code, text = run_main(argv(tmp_path, "--mode", "tune"))
    assert code == 0 and len(CALLS) == 5 * 10
    assert "Acceptance criteria" not in text and "Overall:" not in text
    assert "hnr_db" in text and "suggested normal" in text and "Threshold sweep" in text
    assert "NEVER auto-applied" in text


def test_all_mode_header(tmp_path):
    build_dataset(tmp_path, healthy_sev=0.5)
    code, text = run_main(argv(tmp_path, "--mode", "all"))
    assert code == 0 and len(CALLS) == 9 * 10
    assert "ALL DATA: NOT independent evidence" in text


def test_public_report_has_no_subject_or_file_names(tmp_path):
    build_dataset(tmp_path, healthy_sev=0.5, retries=1)
    rep = tmp_path / "out" / "report.md"
    code, text = run_main(argv(tmp_path, "--out", str(rep)))
    assert code == 1 and rep.is_file()
    public = rep.read_text()
    lowered = public.lower()
    for name in VALIDATE_SUBJECTS + TUNE_SUBJECTS:
        assert not re.search(rf"\b{name}\b", lowered), name
    for frag in (".wav", ".json", "__", str(tmp_path).lower()):
        assert frag not in lowered, frag
    assert "subjects" in public and "Failing runs" in public and "too quiet" in public  # counts, reasons, retries stay
    assert re.search(r"\bsam\b", text.lower()) and ".wav" in text  # the FULL rendering does have them
    assert public.rstrip().endswith(CLOSING)
    assert "Public report written" in text


def test_conditions_show_up_in_report_and_old_sidecars_still_load(tmp_path):
    build_dataset(tmp_path)
    add_clip(tmp_path, "sam", "healthy", 0.05, 900, "speech-normal")  # sidecar without conditions/env
    (tmp_path / "sam__old__1.wav").write_bytes(write_wav(tmp_path / "old.wav", 0.05).read_bytes())  # no sidecar at all: filename prefix
    (tmp_path / "old.wav").unlink()
    code, text = run_main(argv(tmp_path))
    assert code == 0
    assert "| noise | quiet |" in text and "| noise | loud |" in text and "| noise | unspecified |" in text
    assert "Chrome/Windows" in text and "sampleRate=16000" in text and "aec=off" in text


def test_phoneme_flag_recorded_in_header(tmp_path, monkeypatch):
    from models import phoneme

    build_dataset(tmp_path)
    monkeypatch.setattr(phoneme, "phoneme_scoring_enabled", lambda: False)
    monkeypatch.delenv("PHONEME_SCORING", raising=False)
    assert "Phoneme scoring (PHONEME_SCORING): OFF" in run_main(argv(tmp_path))[1]
    monkeypatch.setattr(phoneme, "phoneme_scoring_enabled", lambda: True)
    assert "Phoneme scoring (PHONEME_SCORING): ON" in run_main(argv(tmp_path))[1]
    monkeypatch.setattr(phoneme, "phoneme_scoring_enabled", lambda: False)
    monkeypatch.setenv("PHONEME_SCORING", "true")
    assert "missing" in run_main(argv(tmp_path))[1]


def test_works_when_torch_is_absent(tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "torch", None)  # `import torch` now raises ImportError
    monkeypatch.setenv("PHONEME_SCORING", "true")
    build_dataset(tmp_path)
    code, text = run_main(argv(tmp_path))
    assert code == 0 and "Phoneme scoring (PHONEME_SCORING): OFF" in text


def test_freeze_cli_and_status_in_report(tmp_path):
    build_dataset(tmp_path)
    ff = tmp_path / "frozen.json"
    code, text = run_main(["--freeze", "--freeze-file", str(ff)])
    assert code == 0 and ff.is_file() and "Frozen speech thresholds" in text
    code, text = run_main(["--dir", str(tmp_path), "--freeze-file", str(ff)])
    assert "Thresholds frozen: YES (hash matches" in text
    data = json.loads(ff.read_text())
    data["hash"] = "0" * 16
    ff.write_text(json.dumps(data))
    code, text = run_main(["--dir", str(tmp_path), "--freeze-file", str(ff)])
    assert "Thresholds frozen: NO: config changed since freeze" in text and "NOT independent evidence" in text


def test_split_override_file_moves_subjects(tmp_path):
    build_dataset(tmp_path)
    (tmp_path / "split.json").write_text(json.dumps({"tune": ["sam"], "validate": ["alex"]}))
    code, text = run_main(argv(tmp_path))
    assert len(CALLS) == 4 * 10  # jo, maria, li, alex validate (sam moved out, alex moved in)
    (tmp_path / "s2.json").write_text(json.dumps({"validate": ["sam", "jo", "maria", "li", "alex"], "tune": ["anon", "omar", "priya", "tom"]}))
    CALLS.clear()
    run_main(argv(tmp_path, "--split-file", str(tmp_path / "s2.json")))
    assert len(CALLS) == 5 * 10


def test_exit_2_paths(tmp_path, capsys):
    empty = tmp_path / "empty"
    empty.mkdir()
    assert run_main(["--dir", str(empty)])[0] == 2  # no clips
    assert run_main(["--dir", str(tmp_path / "missing")])[0] == 2  # not a directory
    build_dataset(tmp_path)
    (tmp_path / "split.json").write_text(json.dumps({"tune": ["sam"], "validate": ["sam"]}))
    assert run_main(argv(tmp_path))[0] == 2  # subject in both lists
    (tmp_path / "split.json").write_text("{nope")
    assert run_main(argv(tmp_path))[0] == 2  # bad split file
    (tmp_path / "split.json").unlink()
    assert run_main(argv(tmp_path, "--split-file", str(tmp_path / "nope.json")))[0] == 2  # missing explicit split file
    assert run_main(["--mode", "bogus"])[0] == 2
    err = capsys.readouterr().err
    assert "both tune and validate" in err


def test_unlabeled_clips_are_excluded_and_counted(tmp_path):
    build_dataset(tmp_path)
    write_wav(tmp_path / "misc" / "mystery.wav", 0.5)
    code, text = run_main(argv(tmp_path))
    assert "Unlabeled clips excluded: 1" in text
    assert 0.5 not in [(n - 100) / 1000 for n in CALLS if n == 600]  # never analyzed


def test_subject_fallbacks_filename_then_folder(tmp_path):
    a = write_wav(tmp_path / "recs" / "alex__s__1.wav", 0.05)
    b = write_wav(tmp_path / "zed" / "normal" / "clip.wav", 0.05)
    clips = {c.path.name: c for c in v.cal.discover([tmp_path], "p")}
    assert v.resolve_subject(clips[a.name], {}) == ("alex", "filename")
    assert v.resolve_subject(clips[b.name], {}) == ("zed", "folder")
    assert v.resolve_subject(clips[a.name], {"subject": " Kim "}) == ("Kim", "sidecar")


def test_analyzer_crash_counts_as_retry_not_failure_of_the_tool(tmp_path):
    build_dataset(tmp_path)

    def boom(wav: bytes, phrase: str):
        raise RuntimeError("kaput /secret/path")

    code, text = run_main(argv(tmp_path), analyzer=boom)
    assert code == 1  # retryRate FAILs (100 % retries)
    rep = tmp_path / "r.md"
    run_main(argv(tmp_path, "--out", str(rep)), analyzer=boom)
    assert "kaput" not in rep.read_text() and "analyzer error" in rep.read_text()


def _ctx_for_ramps(runs: list[v.Run]) -> v.ReportContext:
    return v.ReportContext(
        mode="tune", runs=runs, clip_counts={"tune": len(runs), "validate": 0}, subject_counts={"tune": 1, "validate": 0},
        excluded_unlabeled=0, generated="2026-01-01", commit=None, phoneme_on=False, phoneme_note="OFF",
        freeze=v.FreezeStatus("none", "Thresholds frozen: NO freeze file"), split_note="x", phrase="p",
    )
