"""Tests for the speech calibration CLI. Uses tiny generated WAVs and a fake analyzer: no dependency on models.audio."""
import csv
import io
import json
import math
import wave
from pathlib import Path

import numpy as np
import pytest

from backend.schemas import TestResult
from models import calibrate as cal

RETRY_FRAMES = 50


def write_wav(path: Path, severity: float | None, sr: int = 16000) -> Path:
    """Tiny WAV whose length encodes the severity the fake analyzer will report (None = retry)."""
    n = RETRY_FRAMES if severity is None else 100 + int(round(severity * 1000))
    samples = (np.sin(np.linspace(0, 200, n)) * 3000).astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(samples.tobytes())
    return path


def fake_analyzer(wav: bytes, phrase: str) -> TestResult:
    with wave.open(io.BytesIO(wav)) as w:
        n = w.getnframes()
    base = dict(test="speech", started_at=0, duration_ms=1)
    if n == RETRY_FRAMES:
        return TestResult(severity=0, confidence=0, flags=["too quiet, please try again"], needs_retry=True, **base)
    sev = (n - 100) / 1000
    # "cer" tracks severity strongly, "noise" is uninformative, "hnr_db" falls with severity.
    metrics = {"cer": sev * 0.5, "hnr_db": 20 - 10 * sev, "noise": 1.0}
    return TestResult(severity=sev, confidence=0.9, metrics=metrics, flags=[f"phrase={phrase[:10]}", "second"], **base)


def sidecar(path: Path, **kw: object) -> None:
    body = {"schema": 1, "kind": "speech", "subject": "sam", "scenario": "s", "expected": "healthy", **kw}
    path.with_suffix(".json").write_text(json.dumps(body))


def run(argv: list[str], analyzer=fake_analyzer) -> tuple[int, str]:
    out = io.StringIO()
    code = cal.main(argv, analyzer=analyzer, out=out)
    return code, out.getvalue()


# ---------- label inference ----------

def test_folder_labels(tmp_path):
    write_wav(tmp_path / "normal" / "a.wav", 0.05)
    write_wav(tmp_path / "slurred" / "b.wav", 0.95)
    write_wav(tmp_path / "misc" / "c.wav", 0.5)
    clips = {c.path.name: c for c in cal.discover([tmp_path], "phrase")}
    assert clips["a.wav"].expected == "healthy" and clips["a.wav"].label_source == "folder"
    assert clips["b.wav"].expected == "deficit"
    assert clips["c.wav"].expected is None and clips["c.wav"].label_source == "none"


def test_sidecar_wins_over_folder_and_supplies_metadata(tmp_path):
    p = write_wav(tmp_path / "normal" / "kim__mumble__2026.wav", 0.4)
    sidecar(p, subject="kim", scenario="mumble", expected="borderline", targetPhrase="custom phrase")
    (clip,) = cal.discover([tmp_path], "default")
    assert (clip.expected, clip.label_source) == ("borderline", "sidecar")
    assert (clip.subject, clip.scenario, clip.target_phrase) == ("kim", "mumble", "custom phrase")


def test_subject_and_scenario_from_filename_without_sidecar(tmp_path):
    write_wav(tmp_path / "recs" / "alex__slow-speech__2026-01-01.wav", 0.4)
    (clip,) = cal.discover([tmp_path], "default")
    assert (clip.subject, clip.scenario, clip.target_phrase) == ("alex", "slow-speech", "default")


def test_bad_sidecar_falls_back_to_folder(tmp_path):
    p = write_wav(tmp_path / "slurred" / "x.wav", 0.9)
    p.with_suffix(".json").write_text("{not json")
    (clip,) = cal.discover([tmp_path], "d")
    assert clip.expected == "deficit" and clip.warning


def test_invalid_expected_in_sidecar_is_ignored(tmp_path):
    p = write_wav(tmp_path / "x.wav", 0.9)
    sidecar(p, expected="severe")
    (clip,) = cal.discover([tmp_path], "d")
    assert clip.expected is None and "expected" in clip.warning


# ---------- verdicts ----------

def mk(sev: float, conf: float = 0.9, retry: bool = False) -> TestResult:
    return TestResult(test="speech", severity=sev, confidence=conf, started_at=0, duration_ms=1, needs_retry=retry or None)


@pytest.mark.parametrize(
    "expected,sev,ok",
    [
        ("healthy", 0.15, True), ("healthy", 0.16, False),
        ("borderline", 0.2, True), ("borderline", 0.55, True), ("borderline", 0.1, False), ("borderline", 0.6, False),
        ("deficit", 0.85, True), ("deficit", 0.84, False),
    ],
)
def test_anchor_verdicts(expected, sev, ok):
    assert cal.evaluate(expected, mk(sev)).ok is ok


def test_retry_verdict_is_not_pass_or_fail():
    v = cal.evaluate("healthy", mk(0, 0, retry=True))
    assert v.retry and not v.ok


def test_speech_alone_only_alerts_at_severity_times_confidence_one():
    assert not cal.speech_alone_alerts(0.99, 1.0)
    assert not cal.speech_alone_alerts(1.0, 0.99)
    assert cal.speech_alone_alerts(1.0, 1.0)


# ---------- stats ----------

def make_row(name: str, expected: str, result: TestResult) -> cal.Row:
    return cal.Row(cal.Clip(Path(name), "s", "sc", expected, "folder", "p"), result, None, cal.evaluate(expected, result))


def test_summary_math():
    rows = [
        make_row("a", "healthy", mk(0.1)),
        make_row("b", "healthy", mk(0.3)),
        make_row("c", "healthy", mk(0, 0, retry=True)),
    ]
    (s,) = cal.summarize(rows)
    assert (s.n, s.pass_, s.retries) == (3, 1, 1)
    assert s.sev_mean == pytest.approx(0.2) and s.sev_min == 0.1 and s.sev_max == 0.3


def test_cohens_d_and_auc():
    normal, impaired = [1.0, 2.0, 3.0], [4.0, 5.0, 6.0]
    assert cal.auc(normal, impaired) == 1.0
    assert cal.auc(impaired, normal) == 0.0
    assert cal.auc([1.0, 1.0], [1.0, 1.0]) == 0.5
    assert cal.cohens_d(normal, impaired) == pytest.approx(3.0)  # diff 3, pooled sd 1
    assert math.isnan(cal.cohens_d([1.0], [2.0]))


def test_feature_table_ranks_discriminating_features(tmp_path):
    for i, sev in enumerate([0.05, 0.1, 0.12]):
        write_wav(tmp_path / "normal" / f"n{i}.wav", sev)
    for i, sev in enumerate([0.9, 0.95, 1.0]):
        write_wav(tmp_path / "slurred" / f"s{i}.wav", sev)
    rows = cal.run_clips(cal.discover([tmp_path], "p"), fake_analyzer)
    stats = cal.feature_stats(rows)
    by = {s.name: s for s in stats}
    assert by["cer"].auc == 1.0 and by["cer"].d > 3
    assert by["hnr_db"].auc == 0.0 and by["hnr_db"].d < -3  # impaired LOWER
    assert by["noise"].auc == 0.5
    order = [s.name for s in stats]
    assert order.index("noise") > order.index("cer")


# ---------- end to end via main() ----------

def build_passing(root: Path) -> Path:
    write_wav(root / "normal" / "a.wav", 0.05)
    write_wav(root / "normal" / "b.wav", 0.10)
    write_wav(root / "slurred" / "c.wav", 0.90)
    write_wav(root / "slurred" / "d.wav", 1.00)
    return root


def test_exit_zero_when_all_meet_expectations(tmp_path):
    code, out = run(["--dir", str(build_passing(tmp_path))])
    assert code == 0
    assert "Per-scenario summary" in out and "Per-feature" in out and "Headline" in out
    assert "cer" in out
    assert "never trigger" in out


def test_exit_one_and_lists_misses(tmp_path):
    write_wav(tmp_path / "normal" / "loud.wav", 0.6)  # healthy but severity 0.6
    write_wav(tmp_path / "slurred" / "weak.wav", 0.3)
    code, out = run(["--dir", str(tmp_path)])
    assert code == 1
    misses = out.split("Runs missing their expectation")[1]
    assert "loud.wav" in misses and "weak.wav" in misses


def test_retries_are_excluded_from_pass_fail(tmp_path):
    build_passing(tmp_path)
    write_wav(tmp_path / "normal" / "quiet.wav", None)
    code, out = run(["--dir", str(tmp_path)])
    assert code == 0
    assert "Retry rate: 1/5" in out


def test_unlabeled_reported_and_excluded(tmp_path):
    build_passing(tmp_path)
    write_wav(tmp_path / "mystery" / "z.wav", 0.99)
    code, out = run(["--dir", str(tmp_path)])
    assert code == 0
    assert "unlabeled" in out.lower() and "z.wav" in out


def test_default_dirs_used_and_missing_defaults_are_skipped(monkeypatch, tmp_path):
    good = build_passing(tmp_path / "fx")
    monkeypatch.setattr(cal, "DEFAULT_DIRS", (good, tmp_path / "does-not-exist"))
    code, out = run([])
    assert code == 0 and "4 clips" in out


def test_usage_errors_exit_two(tmp_path):
    assert run(["--dir", str(tmp_path / "nope")])[0] == 2
    assert run(["--dir", str(tmp_path)])[0] == 2  # no wav files
    assert run(["--bogus"])[0] == 2


def test_csv_output(tmp_path):
    d = build_passing(tmp_path / "clips")
    out_csv = tmp_path / "out.csv"
    code, _ = run(["--dir", str(d), "--csv", str(out_csv)])
    assert code == 0
    rows = list(csv.DictReader(out_csv.open()))
    assert len(rows) == 4
    assert {"file", "subject", "scenario", "expected", "severity", "confidence", "needs_retry", "flags", "m_cer", "m_hnr_db"} <= set(rows[0])
    by = {Path(r["file"]).name: r for r in rows}
    assert by["c.wav"]["expected"] == "deficit" and float(by["c.wav"]["severity"]) == pytest.approx(0.9)


def test_csv_unwritable_exits_two(tmp_path):
    d = build_passing(tmp_path / "clips")
    assert run(["--dir", str(d), "--csv", str(tmp_path / "no" / "such" / "dir" / "o.csv")])[0] == 2


def test_unreadable_file_does_not_abort(tmp_path, monkeypatch):
    build_passing(tmp_path)
    write_wav(tmp_path / "normal" / "bad.wav", 0.1)
    orig = Path.read_bytes

    def read_bytes(self: Path) -> bytes:
        if self.name == "bad.wav":
            raise PermissionError("denied")
        return orig(self)

    monkeypatch.setattr(Path, "read_bytes", read_bytes)
    code, out = run(["--dir", str(tmp_path)])
    assert code == 1  # a labelled file that could not be scored is a miss
    assert "bad.wav" in out and "denied" in out
    assert "a.wav" in out and "d.wav" in out  # the rest still processed


def test_analyzer_exception_is_reported(tmp_path):
    build_passing(tmp_path)

    def analyzer(wav: bytes, phrase: str) -> TestResult:
        raise RuntimeError("kaboom")

    code, out = run(["--dir", str(tmp_path)], analyzer=analyzer)
    assert code == 1 and "kaboom" in out


def test_verbose_prints_metrics(tmp_path):
    code, out = run(["--dir", str(build_passing(tmp_path)), "--verbose"])
    assert code == 0 and "hnr_db=" in out


def test_phrase_option_reaches_analyzer(tmp_path):
    seen: list[str] = []

    def analyzer(wav: bytes, phrase: str) -> TestResult:
        seen.append(phrase)
        return fake_analyzer(wav, phrase)

    write_wav(tmp_path / "normal" / "a.wav", 0.05)
    run(["--dir", str(tmp_path), "--phrase", "hello there"], analyzer=analyzer)
    assert seen == ["hello there"]
