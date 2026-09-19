"""Speech calibration CLI: replay labelled WAV clips through analyze_speech and report what discriminates.

    python -m models.calibrate [--dir DIR ...] [--phrase TEXT] [--csv out.csv] [--verbose]

Vision equivalent: frontend/src/lib/calibration/replay.ts (same severity anchors, same table style).
Inputs (default dirs, in order): tests/fixtures/audio/ (committed, consented; normal/ -> healthy, slurred/ -> deficit)
and recordings/speech/ (gitignored, from the browser's ?record=1 mode: <subject>__<scenario>__<ts>.wav + .json sidecar).
A sidecar's `expected` wins over folder inference. Unlabeled clips are reported but never pass/fail.
Exit code: 0 all labelled non-retry runs meet expectations, 1 some miss (or could not be scored), 2 usage/IO error.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO

from backend.schemas import TestResult
from models import config
from models.config import TARGET_PHRASE

Analyzer = Callable[[bytes, str], TestResult]

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIRS: tuple[Path, ...] = (REPO_ROOT / "tests" / "fixtures" / "audio", REPO_ROOT / "recordings" / "speech")
FOLDER_LABELS = {"normal": "healthy", "slurred": "deficit"}
EXPECTED_VALUES = ("healthy", "borderline", "deficit")

# Severity anchors shared with the vision tests (docs/spec/02-vision.md "Shared conventions").
HEALTHY_MAX, BORDERLINE_MIN, BORDERLINE_MAX, DEFICIT_MIN = 0.15, 0.2, 0.55, 0.85
RETRY_TARGET = 0.20
# Risk score (docs/spec/05-risk-and-alerts.md): contribution = max_weight * severity * confidence; alert at risk >= threshold.
SPEECH_MAX_WEIGHT, RISK_THRESHOLD = 0.5, 0.5


# ---------- data ----------

@dataclass
class Clip:
    path: Path
    subject: str
    scenario: str
    expected: str | None  # healthy | borderline | deficit | None (unlabeled)
    label_source: str  # sidecar | folder | none
    target_phrase: str
    warning: str = ""


@dataclass
class Verdict:
    ok: bool | None  # None: not judged (unlabeled)
    retry: bool = False
    error: bool = False
    reason: str = ""


@dataclass
class Row:
    clip: Clip
    result: TestResult | None
    error: str | None
    verdict: Verdict


@dataclass
class Summary:
    scenario: str
    expected: str
    n: int
    pass_: int
    retries: int
    sev_mean: float
    sev_min: float
    sev_max: float


@dataclass
class FeatureStat:
    name: str
    n_norm: int
    mean_norm: float
    sd_norm: float
    n_imp: int
    mean_imp: float
    sd_imp: float
    d: float  # Cohen's d, impaired minus normal (sign = direction)
    auc: float  # P(impaired value > normal value); 0.5 = no separation, 0 or 1 = perfect


# ---------- discovery ----------

def _load_sidecar(wav: Path) -> tuple[dict, str]:
    side = wav.with_suffix(".json")
    if not side.is_file():
        return {}, ""
    try:
        data = json.loads(side.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return {}, f"unreadable sidecar ({type(exc).__name__})"
    if not isinstance(data, dict):
        return {}, "sidecar is not a JSON object"
    return data, ""


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def discover(dirs: Sequence[Path], default_phrase: str) -> list[Clip]:
    clips: list[Clip] = []
    seen: set[Path] = set()
    for root in dirs:
        if not root.is_dir():
            continue
        for wav in sorted(p for p in root.rglob("*") if p.is_file() and p.suffix.lower() == ".wav"):
            real = wav.resolve()
            if real in seen:
                continue
            seen.add(real)
            clips.append(_clip_for(wav, root, default_phrase))
    return clips


def _clip_for(wav: Path, root: Path, default_phrase: str) -> Clip:
    side, warning = _load_sidecar(wav)
    folders = [part.lower() for part in wav.relative_to(root).parent.parts]
    folder_label = next((FOLDER_LABELS[f] for f in folders if f in FOLDER_LABELS), None)

    expected: str | None = None
    source = "none"
    side_expected = side.get("expected")
    if side_expected in EXPECTED_VALUES:
        expected, source = side_expected, "sidecar"
    elif "expected" in side:
        warning = (warning + "; " if warning else "") + f"sidecar expected={side_expected!r} is not one of {EXPECTED_VALUES}"
    if expected is None and folder_label:
        expected, source = folder_label, "folder"

    parts = wav.stem.split("__")
    subject = _text(side.get("subject")) or (parts[0] if len(parts) >= 2 else wav.stem)
    scenario = _text(side.get("scenario")) or (parts[1] if len(parts) >= 2 else (folders[-1] if folders else "-"))
    phrase = _text(side.get("targetPhrase")) or default_phrase
    return Clip(wav, subject, scenario, expected, source, phrase, warning)


# ---------- judging ----------

def speech_alone_alerts(severity: float, confidence: float) -> bool:
    """Would the speech result alone reach the risk threshold? 1 - (1 - w*s*c) >= threshold."""
    return 1 - (1 - SPEECH_MAX_WEIGHT * severity * confidence) >= RISK_THRESHOLD


def evaluate(expected: str | None, result: TestResult) -> Verdict:
    if expected is None:
        return Verdict(None, retry=bool(result.needs_retry), reason="unlabeled")
    if result.needs_retry:
        return Verdict(False, retry=True, reason=f"retry: {result.flags[0] if result.flags else 'no reason given'}")
    sev = result.severity
    problems: list[str] = []
    if expected == "healthy":
        if sev > HEALTHY_MAX:
            problems.append(f"severity {sev:.2f} > {HEALTHY_MAX} for a healthy run")
    elif expected == "borderline":
        if not BORDERLINE_MIN <= sev <= BORDERLINE_MAX:
            problems.append(f"severity {sev:.2f} outside {BORDERLINE_MIN}-{BORDERLINE_MAX} for a borderline run")
    elif sev < DEFICIT_MIN:
        problems.append(f"MISSED: severity {sev:.2f} < {DEFICIT_MIN} for a clear deficit")
    if speech_alone_alerts(sev, result.confidence) and expected != "deficit":
        problems.append("would trigger the alert on its own")
    return Verdict(not problems, reason="; ".join(problems) or "ok")


def run_clips(clips: Sequence[Clip], analyzer: Analyzer) -> list[Row]:
    rows: list[Row] = []
    for clip in clips:
        try:
            wav = clip.path.read_bytes()
        except OSError as exc:
            rows.append(Row(clip, None, f"unreadable file: {exc}", Verdict(False if clip.expected else None, error=True, reason=f"unreadable file: {exc}")))
            continue
        try:
            result = analyzer(wav, clip.target_phrase)
        except Exception as exc:  # noqa: BLE001 - one bad clip must not stop the run
            msg = f"analyzer failed: {type(exc).__name__}: {exc}"
            rows.append(Row(clip, None, msg, Verdict(False if clip.expected else None, error=True, reason=msg)))
            continue
        rows.append(Row(clip, result, None, evaluate(clip.expected, result)))
    return rows


# ---------- statistics ----------

def _mean(xs: Sequence[float]) -> float:
    return sum(xs) / len(xs) if xs else math.nan


def _sd(xs: Sequence[float]) -> float:
    if len(xs) < 2:
        return 0.0 if xs else math.nan
    m = _mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def cohens_d(normal: Sequence[float], impaired: Sequence[float]) -> float:
    """(mean_impaired - mean_normal) / pooled sample sd. NaN below 2 samples per group; +-inf if sd is 0 but means differ."""
    if len(normal) < 2 or len(impaired) < 2:
        return math.nan
    dof = len(normal) + len(impaired) - 2
    pooled = math.sqrt(((len(normal) - 1) * _sd(normal) ** 2 + (len(impaired) - 1) * _sd(impaired) ** 2) / dof)
    diff = _mean(impaired) - _mean(normal)
    if pooled == 0:
        return 0.0 if diff == 0 else math.copysign(math.inf, diff)
    return diff / pooled


def auc(normal: Sequence[float], impaired: Sequence[float]) -> float:
    """P(random impaired value > random normal value), ties count half. NaN if either group is empty."""
    if not normal or not impaired:
        return math.nan
    wins = sum(1.0 if i > n else 0.5 if i == n else 0.0 for i in impaired for n in normal)
    return wins / (len(normal) * len(impaired))


def summarize(rows: Sequence[Row]) -> list[Summary]:
    groups: dict[tuple[str, str], list[Row]] = {}
    for r in rows:
        groups.setdefault((r.clip.scenario, r.clip.expected or "-"), []).append(r)
    out: list[Summary] = []
    for (scenario, expected), g in groups.items():
        scored = [r for r in g if r.result is not None and not r.verdict.retry]
        sev = [r.result.severity for r in scored if r.result is not None]
        out.append(Summary(
            scenario, expected, len(g),
            sum(1 for r in g if r.verdict.ok), sum(1 for r in g if r.verdict.retry),
            _mean(sev), min(sev, default=math.nan), max(sev, default=math.nan),
        ))
    order = {"healthy": 0, "borderline": 1, "deficit": 2, "-": 3}
    return sorted(out, key=lambda s: (order.get(s.expected, 9), s.scenario))


def _group_values(rows: Sequence[Row], expected: str) -> dict[str, list[float]]:
    vals: dict[str, list[float]] = {}
    for r in rows:
        if r.clip.expected != expected or r.result is None or r.verdict.retry:
            continue
        pairs = {"severity": r.result.severity, "confidence": r.result.confidence, **r.result.metrics}
        for k, v in pairs.items():
            if math.isfinite(v):
                vals.setdefault(k, []).append(float(v))
    return vals


def feature_stats(rows: Sequence[Row]) -> list[FeatureStat]:
    """Normal (healthy) vs impaired (deficit) per metric, most discriminating first. Borderline runs are left out."""
    norm, imp = _group_values(rows, "healthy"), _group_values(rows, "deficit")
    stats: list[FeatureStat] = []
    for name in sorted(set(norm) | set(imp)):
        n, i = norm.get(name, []), imp.get(name, [])
        stats.append(FeatureStat(name, len(n), _mean(n), _sd(n), len(i), _mean(i), _sd(i), cohens_d(n, i), auc(n, i)))

    def key(s: FeatureStat) -> tuple[float, str]:
        sep = abs(s.auc - 0.5) if math.isfinite(s.auc) else -1.0
        return (-sep, s.name)

    return sorted(stats, key=key)


# ---------- formatting ----------

def _f2(x: float) -> str:
    return f"{x:.2f}" if math.isfinite(x) else "-"


def _num(x: float) -> str:
    if math.isinf(x):
        return "inf" if x > 0 else "-inf"
    if not math.isfinite(x):
        return "-"
    return f"{x:.3g}" if abs(x) < 100 else f"{x:.0f}"


def _pad(s: str, n: int) -> str:
    s = s if len(s) <= n else s[: n - 1] + "~"
    return s + " " * (n - len(s))


def _status(row: Row) -> str:
    v = row.verdict
    if v.error:
        return "ERROR"
    if v.retry:
        return "retry"
    return "-" if v.ok is None else ("ok" if v.ok else "FAIL")


def format_files(rows: Sequence[Row], verbose: bool = False) -> str:
    head = f"{_pad('subject', 14)}{_pad('scenario', 24)}{_pad('file', 30)}{_pad('expect', 11)}{_pad('sev', 6)}{_pad('conf', 6)}{_pad('retry', 6)}{_pad('status', 7)}flags"
    lines = [head, "-" * 130]
    for r in rows:
        res = r.result
        flags = "; ".join(res.flags[:2]) if res else (r.error or "")
        lines.append(
            f"{_pad(r.clip.subject, 14)}{_pad(r.clip.scenario, 24)}{_pad(r.clip.path.name, 30)}{_pad(r.clip.expected or '?', 11)}"
            f"{_pad(_f2(res.severity) if res else '-', 6)}{_pad(_f2(res.confidence) if res else '-', 6)}"
            f"{_pad('yes' if res and res.needs_retry else 'no' if res else '-', 6)}{_pad(_status(r), 7)}{_pad(flags, 60).rstrip()}"
        )
        if verbose:
            lines.append(f"    file: {r.clip.path}  (label from {r.clip.label_source})")
            if r.clip.warning:
                lines.append(f"    warning: {r.clip.warning}")
            if res:
                lines.append("    metrics: " + " ".join(f"{k}={v:.4g}" for k, v in sorted(res.metrics.items())))
                lines.append("    flags: " + " | ".join(res.flags))
                if res.transcript is not None:
                    lines.append(f"    transcript: {res.transcript!r}")
    return "\n".join(lines)


def format_summary(rows: Sequence[Row]) -> str:
    head = f"{_pad('scenario', 30)}{_pad('expect', 11)}{_pad('n', 4)}{_pad('pass', 7)}{_pad('retry', 7)}severity mean [min-max]"
    lines = [head, "-" * 80]
    for s in summarize(rows):
        judged = "-" if s.expected == "-" else f"{s.pass_}/{s.n}"
        lines.append(f"{_pad(s.scenario, 30)}{_pad(s.expected, 11)}{_pad(str(s.n), 4)}{_pad(judged, 7)}{_pad(str(s.retries), 7)}{_f2(s.sev_mean)} [{_f2(s.sev_min)}-{_f2(s.sev_max)}]")
    return "\n".join(lines)


def _ramp_hint(name: str, d: float) -> str:
    """Current ramp from models.config plus whether it points the way the data does. Tolerant of config changes."""
    ramp = getattr(config, "RAMPS", {}).get(name)
    try:
        lo, hi = float(ramp[0]), float(ramp[1])  # type: ignore[index]
    except (TypeError, ValueError, IndexError, KeyError):
        return "-"
    text = f"{lo:g}->{hi:g}"
    if math.isfinite(d) and d != 0 and (hi > lo) != (d > 0):
        text += " WRONG WAY"
    return text


def format_features(rows: Sequence[Row]) -> str:
    stats = feature_stats(rows)
    if not any(s.n_norm and s.n_imp for s in stats):
        return "(need at least one scored healthy and one scored deficit clip to compare features)"
    head = (f"{_pad('feature', 24)}{_pad('normal mean (sd) n', 22)}{_pad('impaired mean (sd) n', 22)}"
            f"{_pad('d', 7)}{_pad('AUC', 6)}{_pad('separation', 11)}current ramp")
    lines = [head, "-" * 110]
    for s in stats:
        sep_v = max(s.auc, 1 - s.auc) if math.isfinite(s.auc) else math.nan
        label = "-" if not math.isfinite(sep_v) else "strong" if sep_v >= 0.9 else "moderate" if sep_v >= 0.75 else "weak"
        direction = "" if not math.isfinite(s.auc) or s.auc == 0.5 else (" (imp higher)" if s.auc > 0.5 else " (imp lower)")
        lines.append(
            f"{_pad(s.name, 24)}{_pad(f'{_num(s.mean_norm)} ({_num(s.sd_norm)}) n={s.n_norm}', 22)}"
            f"{_pad(f'{_num(s.mean_imp)} ({_num(s.sd_imp)}) n={s.n_imp}', 22)}"
            f"{_pad(_num(s.d), 7)}{_pad(_f2(s.auc), 6)}{_pad(label, 11)}{_ramp_hint(s.name, s.d)}{direction}"
        )
    lines.append("d = Cohen's d (impaired - normal); AUC = P(impaired > normal): 0.5 no separation, 1 impaired always higher, 0 always lower.")
    lines.append("Features with weak separation or WRONG WAY ramps are candidates to reweight or re-ramp in models/config.py.")
    return "\n".join(lines)


def headlines(rows: Sequence[Row]) -> tuple[str, list[str]]:
    """(text, misses). Misses: labelled runs that are neither retries nor passes (includes unscoreable files)."""
    scored = [r for r in rows if r.result is not None and not r.verdict.retry]
    retries = [r for r in rows if r.verdict.retry]
    unlabeled = [r for r in rows if r.clip.expected is None]
    healthy = [r for r in scored if r.clip.expected == "healthy"]
    deficit = [r for r in scored if r.clip.expected == "deficit"]
    alarms = [r for r in healthy if r.result is not None and speech_alone_alerts(r.result.severity, r.result.confidence)]
    over = [r for r in healthy if r.result is not None and r.result.severity > HEALTHY_MAX]
    hits = [r for r in deficit if r.result is not None and r.result.severity >= DEFICIT_MIN]
    n = len(rows)
    rate = len(retries) / n if n else 0.0
    lines = [
        f"Runs: {n} ({len(unlabeled)} unlabeled, excluded from pass/fail)",
        f"Retry rate: {len(retries)}/{n} = {rate:.0%} (target under {RETRY_TARGET:.0%}){'  <-- too high' if rate > RETRY_TARGET else ''}",
        f"Healthy false alarms (speech alone would trigger the alert): {len(alarms)}/{len(healthy)}",
        f"  Note: speech max weight {SPEECH_MAX_WEIGHT}, threshold {RISK_THRESHOLD}: risk = 1 - (1 - {SPEECH_MAX_WEIGHT}*severity*confidence) >= {RISK_THRESHOLD}",
        "  needs severity*confidence = 1.0, so speech alone can never trigger below severity 1.0. This count is a weak check;",
        "  the number that matters is healthy severity vs the anchor below.",
        f"Healthy runs above severity anchor {HEALTHY_MAX}: {len(over)}/{len(healthy)}",
        f"Impaired runs meeting the anchor (severity >= {DEFICIT_MIN}): {len(hits)}/{len(deficit)}",
    ]
    misses = [f"{'ERROR' if r.verdict.error else 'FAIL '} {r.clip.path} [{r.clip.scenario}] {r.verdict.reason}" for r in rows if r.verdict.ok is False and not r.verdict.retry]
    return "\n".join(lines), misses


def write_csv(rows: Sequence[Row], path: Path) -> None:
    metric_names = sorted({k for r in rows if r.result for k in r.result.metrics})
    cols = ["file", "subject", "scenario", "expected", "label_source", "severity", "confidence", "needs_retry", "flags", "transcript", "status", "reason", "error"] + [f"m_{k}" for k in metric_names]
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in rows:
            res = r.result
            rec: dict[str, object] = {
                "file": str(r.clip.path), "subject": r.clip.subject, "scenario": r.clip.scenario,
                "expected": r.clip.expected or "", "label_source": r.clip.label_source,
                "status": _status(r), "reason": r.verdict.reason, "error": r.error or "",
            }
            if res:
                rec.update(severity=res.severity, confidence=res.confidence, needs_retry=bool(res.needs_retry),
                           flags=" | ".join(res.flags), transcript=res.transcript or "")
                rec.update({f"m_{k}": v for k, v in res.metrics.items()})
            w.writerow(rec)


# ---------- CLI ----------

def _default_analyzer() -> Analyzer:
    from models.audio import (
        analyze_speech,  # lazy: keeps this module importable (and testable) without the DSP stack
    )

    return analyze_speech


def main(argv: Sequence[str] | None = None, analyzer: Analyzer | None = None, out: TextIO | None = None) -> int:
    out = out or sys.stdout
    parser = argparse.ArgumentParser(prog="python -m models.calibrate", description="Replay labelled speech clips through analyze_speech.")
    parser.add_argument("--dir", action="append", type=Path, dest="dirs", help="directory of WAVs (repeatable; replaces the defaults)")
    parser.add_argument("--phrase", default=TARGET_PHRASE, help="target phrase when a clip has none (default: config TARGET_PHRASE)")
    parser.add_argument("--csv", type=Path, help="write every per-file metric to this CSV")
    parser.add_argument("--verbose", action="store_true", help="show metrics, flags, transcript and label source per file")
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return int(exc.code) if isinstance(exc.code, int) else 2

    if args.dirs:
        missing = [d for d in args.dirs if not d.is_dir()]
        if missing:
            print(f"error: not a directory: {', '.join(str(d) for d in missing)}", file=sys.stderr)
            return 2
        dirs: Sequence[Path] = args.dirs
    else:
        dirs = DEFAULT_DIRS
    clips = discover(dirs, args.phrase)
    if not clips:
        print(f"error: no .wav files found in: {', '.join(str(d) for d in dirs)}\n"
              "Add consented clips under tests/fixtures/audio/{normal,slurred}/ or record with the browser's ?record=1 mode.", file=sys.stderr)
        return 2

    try:
        rows = run_clips(clips, analyzer or _default_analyzer())
    except ImportError as exc:
        print(f"error: could not import the speech analyzer: {exc}", file=sys.stderr)
        return 2

    text, misses = headlines(rows)
    print(f"Speech calibration: {len(clips)} clips from {', '.join(str(d) for d in dirs)}\n", file=out)
    print("== Per-file ==", file=out)
    print(format_files(rows, args.verbose), file=out)
    print("\n== Per-scenario summary ==", file=out)
    print(format_summary(rows), file=out)
    print("\n== Per-feature: normal (healthy) vs impaired (deficit) ==", file=out)
    print(format_features(rows), file=out)
    print("\n== Headline ==", file=out)
    print(text, file=out)
    warnings = [f"{r.clip.path}: {r.clip.warning}" for r in rows if r.clip.warning]
    unlabeled = [str(r.clip.path) for r in rows if r.clip.expected is None]
    if unlabeled:
        print(f"\nUnlabeled clips (no sidecar expected, not in normal/ or slurred/): {len(unlabeled)}", file=out)
        for p in unlabeled:
            print(f"  {p}", file=out)
    if warnings:
        print("\nWarnings:", file=out)
        for w in warnings:
            print(f"  {w}", file=out)
    print(f"\nRuns missing their expectation: {len(misses)}", file=out)
    for m in misses:
        print(f"  {m}", file=out)

    if args.csv:
        try:
            write_csv(rows, args.csv)
        except OSError as exc:
            print(f"error: could not write CSV: {exc}", file=sys.stderr)
            return 2
        print(f"\nCSV written to {args.csv}", file=out)
    return 1 if misses else 0


if __name__ == "__main__":
    raise SystemExit(main())
