"""Speech VALIDATION tool: prove accuracy on held-out people instead of tuning and testing on the same data.

    python -m models.validate [--mode validate|tune|all] [--dir DIR ...] [--split-file PATH]
                              [--out REPORT.md] [--freeze] [--phrase PHRASE]

Workflow (see docs/CALIBRATION.md): tune thresholds on the TUNE split (`--mode tune`), freeze them (`--freeze`), then
validate ONCE on the VALIDATION split (`--mode validate`). Subjects are split deterministically by a hash of the
subject name (60 % tune / 40 % validate; optional `split.json` override), so nobody's clips end up in both.

Modes
  validate  validation split only: acceptance criteria (PASS / FAIL / INSUFFICIENT DATA), freeze status.
            Exit 0 = no criterion FAILS (INSUFFICIENT prints loudly but is exit 0); 1 = a criterion FAILS; 2 = usage/IO error.
  tune      tuning split only: tables, ramp suggestions (never applied), threshold sweep. No pass/fail (exit 0).
  all       everything pooled. Header says "ALL DATA: NOT independent evidence". Exit 0.
`--out` writes the PUBLIC rendering (no subject or file names) suitable for committing under docs/validation/.

Vision equivalent: frontend/src/lib/calibration (same split, statistics and report layout).
Mimicked deficits are not real stroke patients: this validates screening-heuristic behaviour on volunteers, not clinical accuracy.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import re
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence, TextIO

from backend.schemas import TestResult
from models import calibrate as cal
from models import config
from models.calibrate import speech_alone_alerts
from models.validation_stats import (  # noqa: F401  (re-exported for callers and tests)
    SPLITS,
    Z_ONE_SIDED_95,
    Z_TWO_SIDED_95,
    SplitError,
    auc,
    bucket_for,
    cohens_d,
    median,
    normalize_subject,
    parse_split_override,
    percentile,
    split_for,
    wilson,
)

Analyzer = Callable[[bytes, str], TestResult]

REPO_ROOT = cal.REPO_ROOT
FREEZE_PATH = REPO_ROOT / "docs" / "validation" / "frozen-speech.json"
DISCLAIMER = "Mimicked deficits are not real stroke patients: this validates screening-heuristic behaviour on volunteers, not clinical accuracy."

# ---------------------------------------------------------------------------------------------------------
# Acceptance criteria: defined ONCE, here. Evaluated on the validation split, non-retry runs unless stated.
# ---------------------------------------------------------------------------------------------------------
FALSE_ALARM_MIN_N = 60  # healthy runs needed before the false-alarm criterion can pass or fail
FALSE_ALARM_MAX_UPPER = 0.05  # one-sided 95 % Wilson UPPER bound of the alert rate must be below this
HEALTHY_ANCHOR_SEVERITY = 0.15  # healthy runs at or below this severity are "anchored"
HEALTHY_ANCHOR_MIN_N, HEALTHY_ANCHOR_MIN_RATE = 20, 0.95
DEFICIT_SEVERITY = 0.85  # mimicked deficits at or above this are "detected"
DEFICIT_MIN_N, DEFICIT_MIN_RATE = 20, 0.90
RETRY_MIN_N, RETRY_MAX_RATE = 20, 0.20
BORDERLINE_MIN_N = 5
CONDITION_MIN_N = 10  # a condition group with fewer healthy runs than this is flagged as unreliable
RAMP_MIN_PER_GROUP = 2  # need at least this many healthy and deficit runs to suggest a ramp
SWEEP_CUTOFFS = tuple(round(0.10 + 0.05 * i, 2) for i in range(18))  # 0.10 .. 0.95
SPEECH_CONDITION_KEYS = ("noise", "mic", "nativeEnglish", "device")  # vision-only keys (glasses, lighting, ...) are ignored here
PASS, FAIL, INSUFFICIENT = "PASS", "FAIL", "INSUFFICIENT DATA"
_EPS = 1e-12


# ---------- data ----------

@dataclass
class Run:
    path: Path
    subject: str
    split: str  # tune | validate
    scenario: str
    expected: str  # healthy | borderline | deficit
    severity: float = math.nan
    confidence: float = math.nan
    retry: bool = False  # analyzer asked for a retry (or crashed: treated as a retry, like the endpoint does)
    error: str | None = None
    retry_reason: str = ""
    flags: list[str] = field(default_factory=list)
    metrics: dict[str, float] = field(default_factory=dict)
    conditions: dict[str, Any] = field(default_factory=dict)
    env: dict[str, Any] = field(default_factory=dict)
    ok: bool | None = None  # calibrate's verdict against the shared anchors (None for retries)
    problem: str = ""
    subject_source: str = "sidecar"

    @property
    def scored(self) -> bool:
        return not self.retry

    @property
    def alert(self) -> bool:
        return self.scored and speech_alone_alerts(self.severity, self.confidence)


@dataclass
class Criterion:
    name: str
    status: str
    k: int
    n: int
    rate: float
    lo: float
    hi: float
    kind: str  # 'one-sided upper' | 'two-sided'
    requirement: str
    detail: str = ""


@dataclass
class ConditionGroup:
    key: str
    value: str
    runs: int
    retries: int
    healthy_n: int
    healthy_ok: int  # healthy runs with severity <= HEALTHY_ANCHOR_SEVERITY
    deficit_n: int
    deficit_hit: int  # deficit runs with severity >= DEFICIT_SEVERITY

    @property
    def warning(self) -> str:
        return f"healthy n<{CONDITION_MIN_N}: unreliable" if self.healthy_n < CONDITION_MIN_N else ""


@dataclass
class SweepRow:
    cutoff: float
    tune_healthy: tuple[int, int] | None  # (runs at or above the cutoff, n) ; None = split not scored
    tune_deficit: tuple[int, int] | None
    validate_healthy: tuple[int, int] | None
    validate_deficit: tuple[int, int] | None


@dataclass
class RampSuggestion:
    metric: str
    n_healthy: int
    n_deficit: int
    direction: str = ""  # 'higher is worse' | 'lower is worse'
    normal_edge: float = math.nan
    abnormal_edge: float = math.nan
    auc: float = math.nan
    d: float = math.nan
    label: str = "-"  # strong | moderate | weak
    useful: bool = False
    note: str = ""
    current: tuple[float, float] | None = None
    wrong_way: bool = False


# ---------- discovery / sidecar helpers ----------

def load_sidecar(wav: Path) -> tuple[dict, str]:
    """Public wrapper over models.calibrate's sidecar loader: (dict, warning). Old sidecars without conditions/env load fine."""
    return cal._load_sidecar(wav)


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def resolve_subject(clip: cal.Clip, sidecar: Mapping[str, Any]) -> tuple[str, str]:
    """Sidecar `subject`, else filename prefix (<subject>__<scenario>__...), else folder name. Returns (subject, source)."""
    side = _text(sidecar.get("subject"))
    if side:
        return side, "sidecar"
    parts = clip.path.stem.split("__")
    if len(parts) >= 2 and parts[0].strip():
        return parts[0].strip(), "filename"
    folder = clip.path.parent
    if folder.name.lower() in cal.FOLDER_LABELS:  # normal/ and slurred/ are labels, not people
        folder = folder.parent
    return folder.name or "unknown", "folder"


def _dict(value: object) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def load_split_override(paths: Sequence[Path], explicit: bool) -> dict[str, str]:
    """Merge split.json files (explicit --split-file must exist; defaults are optional). Raises SplitError / OSError."""
    merged: dict[str, str] = {}
    for p in paths:
        if not p.is_file():
            if explicit:
                raise OSError(f"split file not found: {p}")
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except ValueError as exc:
            raise SplitError(f"{p}: not valid JSON ({exc})") from exc
        try:
            part = parse_split_override(data)
        except SplitError as exc:
            raise SplitError(f"{p}: {exc}") from exc
        clash = sorted(k for k, v in part.items() if merged.get(k, v) != v)
        if clash:
            raise SplitError(f"subject(s) listed in both tune and validate across split files: {', '.join(clash)}")
        merged.update(part)
    return merged


def run_from_row(row: cal.Row, subject: str, source: str, split: str, sidecar: Mapping[str, Any]) -> Run:
    conditions, env = _dict(sidecar.get("conditions")), _dict(sidecar.get("env"))
    base = dict(path=row.clip.path, subject=subject, split=split, scenario=row.clip.scenario, expected=row.clip.expected or "",
                conditions=conditions, env=env, subject_source=source)
    if row.result is None:
        return Run(**base, retry=True, error=row.error or "analyzer failed", retry_reason="analyzer error", ok=None, problem=row.error or "")
    res = row.result
    retry = bool(res.needs_retry)
    metrics = {k: float(v) for k, v in res.metrics.items() if isinstance(v, (int, float)) and math.isfinite(v)}
    return Run(**base, severity=float(res.severity), confidence=float(res.confidence), retry=retry,
               retry_reason=(res.flags[0] if res.flags else "no reason given") if retry else "",
               flags=list(res.flags), metrics=metrics, ok=None if retry else row.verdict.ok,
               problem="" if retry or row.verdict.ok else row.verdict.reason)


# ---------- criteria ----------

def _rate(k: int, n: int) -> float:
    return k / n if n else math.nan


def needed_zero_alarm_runs(k: int, n: int) -> int | None:
    """How many MORE healthy runs, all without an alarm, until the false-alarm criterion could pass. None: unreachable."""
    for m in range(0, 100_000):
        total = n + m
        if total >= FALSE_ALARM_MIN_N and wilson(k, total, Z_ONE_SIDED_95)[1] < FALSE_ALARM_MAX_UPPER:
            return m
    return None


def _crit_rate(name: str, k: int, n: int, min_n: int, min_rate: float, requirement: str) -> Criterion:
    lo, hi = wilson(k, n, Z_TWO_SIDED_95)
    rate = _rate(k, n)
    if n < min_n:
        status, detail = INSUFFICIENT, f"n={n} < {min_n}: need at least {min_n - n} more"
    else:
        status, detail = (PASS if rate >= min_rate - _EPS else FAIL), ""
    return Criterion(name, status, k, n, rate, lo, hi, "two-sided", requirement, detail)


def criteria(runs: Sequence[Run]) -> list[Criterion]:
    """The five acceptance criteria (spec) over `runs` (already restricted to the split being judged)."""
    healthy = [r for r in runs if r.expected == "healthy" and r.scored]
    deficit = [r for r in runs if r.expected == "deficit" and r.scored]
    borderline = [r for r in runs if r.expected == "borderline" and r.scored]
    out: list[Criterion] = []

    # falseAlarm: healthy runs where the speech result alone would trigger the alert (one-sided 95 % upper bound < 5 %)
    n, k = len(healthy), sum(1 for r in healthy if r.alert)
    lo, hi = wilson(k, n, Z_ONE_SIDED_95)
    req = f"healthy n >= {FALSE_ALARM_MIN_N} and one-sided 95% Wilson upper bound < {FALSE_ALARM_MAX_UPPER:.0%}"
    if n < FALSE_ALARM_MIN_N:
        more = needed_zero_alarm_runs(k, n)
        need = f"needs {more} more healthy runs with 0 further alarms to reach < {FALSE_ALARM_MAX_UPPER:.0%}" if more is not None else \
            f"cannot reach < {FALSE_ALARM_MAX_UPPER:.0%} with {k} alarm(s) at any n"
        out.append(Criterion("falseAlarm", INSUFFICIENT, k, n, _rate(k, n), lo, hi, "one-sided upper", req, need))
    else:
        out.append(Criterion("falseAlarm", PASS if hi < FALSE_ALARM_MAX_UPPER else FAIL, k, n, _rate(k, n), lo, hi, "one-sided upper", req,
                             f"upper bound {hi:.1%} {'<' if hi < FALSE_ALARM_MAX_UPPER else '>='} {FALSE_ALARM_MAX_UPPER:.0%}"))

    out.append(_crit_rate("healthyAnchor", sum(1 for r in healthy if r.severity <= HEALTHY_ANCHOR_SEVERITY + _EPS), len(healthy),
                          HEALTHY_ANCHOR_MIN_N, HEALTHY_ANCHOR_MIN_RATE,
                          f"healthy n >= {HEALTHY_ANCHOR_MIN_N} and share with severity <= {HEALTHY_ANCHOR_SEVERITY} >= {HEALTHY_ANCHOR_MIN_RATE:.0%}"))
    out.append(_crit_rate("deficitDetection", sum(1 for r in deficit if r.severity >= DEFICIT_SEVERITY - _EPS), len(deficit),
                          DEFICIT_MIN_N, DEFICIT_MIN_RATE,
                          f"deficit n >= {DEFICIT_MIN_N} and share with severity >= {DEFICIT_SEVERITY} >= {DEFICIT_MIN_RATE:.0%}"))

    # retryRate: retries / ALL runs (analyzer crashes count as retries)
    total, retries = len(runs), sum(1 for r in runs if r.retry)
    rlo, rhi = wilson(retries, total, Z_TWO_SIDED_95)
    rrate = _rate(retries, total)
    if total < RETRY_MIN_N:
        rstatus, rdetail = INSUFFICIENT, f"n={total} < {RETRY_MIN_N}: need at least {RETRY_MIN_N - total} more"
    else:
        rstatus, rdetail = (PASS if rrate <= RETRY_MAX_RATE + _EPS else FAIL), ""
    out.append(Criterion("retryRate", rstatus, retries, total, rrate, rlo, rhi, "two-sided",
                         f"all runs n >= {RETRY_MIN_N} and retries / runs <= {RETRY_MAX_RATE:.0%}", rdetail))

    # borderlineNoAlert
    bn, bk = len(borderline), sum(1 for r in borderline if r.alert)
    blo, bhi = wilson(bk, bn, Z_TWO_SIDED_95)
    if bn < BORDERLINE_MIN_N:
        bstatus, bdetail = INSUFFICIENT, f"n={bn} < {BORDERLINE_MIN_N}: need at least {BORDERLINE_MIN_N - bn} more"
    else:
        bstatus, bdetail = (PASS if bk == 0 else FAIL), ""
    out.append(Criterion("borderlineNoAlert", bstatus, bk, bn, _rate(bk, bn), blo, bhi, "two-sided",
                         f"borderline n >= {BORDERLINE_MIN_N} and no run alerts", bdetail))
    return out


def overall(crits: Sequence[Criterion]) -> str:
    if any(c.status == FAIL for c in crits):
        return FAIL
    if any(c.status == INSUFFICIENT for c in crits):
        return INSUFFICIENT
    return PASS


# ---------- breakdowns ----------

def _cond_value(run: Run, key: str) -> str:
    v = run.conditions.get(key)
    if v is None or v == "":
        return "unspecified"
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v) if isinstance(v, (str, int, float)) else "unspecified"


def condition_breakdown(runs: Sequence[Run], keys: Sequence[str] = SPEECH_CONDITION_KEYS) -> list[ConditionGroup]:
    """Per condition value: runs, retries, healthy-anchor and deficit-detection counts (non-retry)."""
    out: list[ConditionGroup] = []
    for key in keys:
        groups: dict[str, list[Run]] = {}
        for r in runs:
            groups.setdefault(_cond_value(r, key), []).append(r)
        for value in sorted(groups, key=lambda v: (v == "unspecified", v)):
            g = groups[value]
            healthy = [r for r in g if r.expected == "healthy" and r.scored]
            deficit = [r for r in g if r.expected == "deficit" and r.scored]
            out.append(ConditionGroup(
                key, value, len(g), sum(1 for r in g if r.retry),
                len(healthy), sum(1 for r in healthy if r.severity <= HEALTHY_ANCHOR_SEVERITY + _EPS),
                len(deficit), sum(1 for r in deficit if r.severity >= DEFICIT_SEVERITY - _EPS),
            ))
    return out


def sweep(tune: Sequence[Run] | None, validate: Sequence[Run] | None, cutoffs: Sequence[float] = SWEEP_CUTOFFS) -> list[SweepRow]:
    """For each cutoff: healthy fraction >= cutoff (false-alarm side) and deficit fraction >= cutoff (detection side), non-retry."""
    def counts(runs: Sequence[Run] | None, expected: str, cutoff: float) -> tuple[int, int] | None:
        if runs is None:
            return None
        sev = [r.severity for r in runs if r.expected == expected and r.scored]
        return (sum(1 for s in sev if s >= cutoff - _EPS), len(sev))

    return [SweepRow(c, counts(tune, "healthy", c), counts(tune, "deficit", c), counts(validate, "healthy", c), counts(validate, "deficit", c))
            for c in cutoffs]


def ramp_suggestions(tune_runs: Sequence[Run]) -> list[RampSuggestion]:
    """Suggested ramp edges per numeric metric from the TUNE split only (non-retry). Never applied automatically."""
    scored = [r for r in tune_runs if r.scored]
    names = sorted({k for r in scored for k in r.metrics})
    out: list[RampSuggestion] = []
    current_ramps = getattr(config, "RAMPS", {})
    for name in names:
        h = [r.metrics[name] for r in scored if r.expected == "healthy" and name in r.metrics]
        d = [r.metrics[name] for r in scored if r.expected == "deficit" and name in r.metrics]
        cur: tuple[float, float] | None = None
        try:
            ramp = current_ramps.get(name)
            cur = (float(ramp[0]), float(ramp[1])) if ramp is not None else None
        except (TypeError, ValueError, IndexError):
            cur = None
        s = RampSuggestion(name, len(h), len(d), current=cur)
        if len(h) < RAMP_MIN_PER_GROUP or len(d) < RAMP_MIN_PER_GROUP:
            s.note = f"insufficient data (need >= {RAMP_MIN_PER_GROUP} healthy and >= {RAMP_MIN_PER_GROUP} deficit runs)"
            out.append(s)
            continue
        m_h, m_d = median(h), median(d)
        higher_worse = m_d > m_h
        s.direction = "higher is worse" if higher_worse else "lower is worse"
        s.normal_edge = percentile(h, 90 if higher_worse else 10)
        s.abnormal_edge = m_d
        s.auc, s.d = auc(h, d), cohens_d(h, d)
        s.label = "strong" if (s.auc >= 0.9 or s.auc <= 0.1) else "moderate" if (s.auc >= 0.75 or s.auc <= 0.25) else "weak"
        s.useful = s.normal_edge < s.abnormal_edge if higher_worse else s.normal_edge > s.abnormal_edge
        if not s.useful:
            s.note = "no useful separation"
        if cur is not None and m_d != m_h and ((cur[1] > cur[0]) != higher_worse):
            s.wrong_way = True
        out.append(s)
    return out


# ---------- environment / freeze ----------

def _ua_family(ua: str) -> str:
    browser = next((name for pat, name in (("Edg/", "Edge"), ("OPR/", "Opera"), ("Firefox/", "Firefox"), ("Chrome/", "Chrome"), ("Safari/", "Safari")) if pat in ua), "")
    os_name = next((name for pat, name in (("Windows", "Windows"), ("Android", "Android"), ("iPhone", "iOS"), ("iPad", "iOS"), ("Mac OS X", "macOS"), ("Linux", "Linux")) if pat in ua), "")
    return "/".join(x for x in (browser, os_name) if x)


def env_key(run: Run) -> str:
    """One line per distinct recording environment; contains no subject or file names."""
    e, c = run.env, run.conditions
    parts: list[str] = []
    if isinstance(e.get("userAgent"), str) and _ua_family(e["userAgent"]):
        parts.append(_ua_family(e["userAgent"]))
    if c.get("device"):
        parts.append(f"device={c['device']}")
    if e.get("sampleRate") is not None:
        parts.append(f"sampleRate={e['sampleRate']}")
    for key, short in (("echoCancellation", "aec"), ("noiseSuppression", "ns"), ("autoGainControl", "agc")):
        if e.get(key) is not None:
            parts.append(f"{short}={'on' if e[key] else 'off'}")
    return " ".join(parts) if parts else "(no env recorded)"


def _canon(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _canon(v) for k, v in sorted(value.items(), key=lambda kv: str(kv[0]))}
    if isinstance(value, (list, tuple)):
        return [_canon(v) for v in value]
    if isinstance(value, (set, frozenset)):
        return sorted((_canon(v) for v in value), key=repr)
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    return repr(value)


def freeze_config() -> dict[str, dict[str, Any]]:
    """Everything that changes speech scores: UPPERCASE constants of models.config, and of models.phoneme the numeric /
    tuple / list / dict ones (plus the model id). models.phoneme is torch-free at import."""
    from models import phoneme  # lazy; never imports torch

    def public(mod: Any) -> dict[str, Any]:
        return {n: getattr(mod, n) for n in sorted(dir(mod)) if n.isupper() and not n.startswith("_")}

    phon = {n: v for n, v in public(phoneme).items()
            if n == "PHONEME_MODEL_ID" or (isinstance(v, (int, float, tuple, list, dict)) and not isinstance(v, bool))}
    return {"config": _canon(public(config)), "phoneme": _canon(phon)}


def freeze_hash(cfg: Mapping[str, Any] | None = None) -> str:
    """First 16 hex of sha256 over canonical JSON (recursively sorted keys, arrays in order, compact separators)."""
    text = json.dumps(_canon(cfg if cfg is not None else freeze_config()), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def git_commit() -> str | None:
    try:
        res = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, capture_output=True, text=True, timeout=10, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    sha = res.stdout.strip()
    return sha if res.returncode == 0 and re.fullmatch(r"[0-9a-f]{7,64}", sha) else None


def phoneme_scoring_status() -> tuple[bool, str]:
    """(on, note). ON only when env PHONEME_SCORING is truthy AND torch + transformers are importable (models.phoneme's rule)."""
    env_on = os.getenv("PHONEME_SCORING", "").strip().lower() in {"1", "true", "yes", "on"}
    try:
        from models import phoneme

        on = bool(phoneme.phoneme_scoring_enabled())
    except Exception:  # noqa: BLE001 - never let the report fail over this
        on = False
    if on:
        return True, "ON"
    return False, "OFF (PHONEME_SCORING set but torch/transformers missing)" if env_on else "OFF"


@dataclass
class FreezeStatus:
    state: str  # yes | changed | none
    text: str
    frozen_hash: str | None = None
    current_hash: str = ""
    frozen_at: str | None = None
    commit: str | None = None
    note: str = ""


def write_freeze(path: Path | None = None, now: dt.datetime | None = None, commit: str | None = None, phoneme_on: bool | None = None) -> dict[str, Any]:
    path = path or FREEZE_PATH
    cfg = freeze_config()
    payload = {
        "frozenAt": (now or dt.datetime.now(dt.timezone.utc)).isoformat(timespec="seconds"),
        "gitCommit": commit if commit is not None else git_commit(),
        "hash": freeze_hash(cfg),
        "config": cfg,
        "phonemeScoring": phoneme_scoring_status()[0] if phoneme_on is None else phoneme_on,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    return payload


def freeze_status(path: Path | None = None) -> FreezeStatus:
    path = path or FREEZE_PATH
    current = freeze_hash()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        frozen = str(data["hash"])
    except (OSError, ValueError, KeyError, TypeError):
        return FreezeStatus("none", "Thresholds frozen: NO freeze file", None, current,
                            note="Run `python -m models.validate --freeze` after tuning and BEFORE validating.")
    frozen_at = str(data.get("frozenAt") or "")
    commit = data.get("gitCommit") if isinstance(data.get("gitCommit"), str) else None
    if frozen != current:
        return FreezeStatus("changed", f"Thresholds frozen: NO: config changed since freeze (frozen {frozen} vs current {current}) so this is NOT independent evidence",
                            frozen, current, frozen_at, commit)
    when = frozen_at[:10] or "unknown date"
    at = commit[:7] if commit else "unknown commit"
    status = FreezeStatus("yes", f"Thresholds frozen: YES (hash matches, frozen {when} at {at})", frozen, current, frozen_at, commit)
    if isinstance(data.get("phonemeScoring"), bool):
        now_on = phoneme_scoring_status()[0]
        if data["phonemeScoring"] != now_on:
            status.note = (f"Phoneme scoring was {'ON' if data['phonemeScoring'] else 'OFF'} at freeze but is "
                           f"{'ON' if now_on else 'OFF'} for this run: scores are not comparable.")
    return status


# ---------- report ----------

@dataclass
class ReportContext:
    mode: str  # validate | tune | all
    runs: list[Run]  # scored (analyzed) runs
    clip_counts: dict[str, int]  # labelled clips per split (analyzed or not)
    subject_counts: dict[str, int]
    excluded_unlabeled: int
    generated: str
    commit: str | None
    phoneme_on: bool
    phoneme_note: str
    freeze: FreezeStatus
    split_note: str
    phrase: str
    no_subject: int = 0
    warnings: list[str] = field(default_factory=list)

    def evaluated(self) -> list[Run]:
        return list(self.runs) if self.mode == "all" else [r for r in self.runs if r.split == self.mode]


def _pct(x: float, digits: int = 1) -> str:
    return f"{x * 100:.{digits}f}%" if math.isfinite(x) else "-"


def _f2(x: float) -> str:
    return f"{x:.2f}" if math.isfinite(x) else "-"


def _num(x: float) -> str:
    return cal._num(x)


def _interval(lo: float, hi: float) -> str:
    return f"[{_pct(lo)}, {_pct(hi)}]" if math.isfinite(lo) else "-"


def _kn(k: int, n: int) -> str:
    return f"{k}/{n}" if n else "0/0"


def _cell(counts: tuple[int, int] | None) -> str:
    if counts is None:
        return "not scored"
    k, n = counts
    return f"{_pct(k / n, 0)} ({k}/{n})" if n else "-"


def _table(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> list[str]:
    def esc(s: str) -> str:
        return s.replace("|", "\\|").replace("\n", " ")

    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    lines += ["| " + " | ".join(esc(c) for c in row) + " |" for row in rows]
    return lines


MODE_TEXT = {
    "validate": "validate (held-out validation split only)",
    "tune": "tune (tuning split only; no pass/fail)",
    "all": "ALL DATA: NOT independent evidence",
}


def scenario_rows(runs: Sequence[Run]) -> list[list[str]]:
    groups: dict[tuple[str, str], list[Run]] = {}
    for r in runs:
        groups.setdefault((r.scenario, r.expected), []).append(r)
    order = {"healthy": 0, "borderline": 1, "deficit": 2}
    rows = []
    for (scenario, expected), g in sorted(groups.items(), key=lambda kv: (order.get(kv[0][1], 9), kv[0][0])):
        sev = [r.severity for r in g if r.scored]
        rows.append([scenario, expected, str(len(g)), _kn(sum(1 for r in g if r.ok), len(g)), str(sum(1 for r in g if r.retry)),
                     f"{_f2(sum(sev) / len(sev) if sev else math.nan)} [{_f2(min(sev, default=math.nan))}-{_f2(max(sev, default=math.nan))}]",
                     str(sum(1 for r in g if r.alert))])
    return rows


def failing_runs(runs: Sequence[Run]) -> list[Run]:
    return [r for r in runs if (r.ok is False and not r.retry) or r.error]


def render(ctx: ReportContext, public: bool) -> str:
    L: list[str] = []
    runs = ctx.evaluated()
    L += ["# StrokeShield speech validation report", ""]
    L += [f"- Date: {ctx.generated}", f"- Git commit: {ctx.commit or 'unknown'}", f"- Mode: {MODE_TEXT[ctx.mode]}",
          f"- Split: {ctx.split_note}", f"- Phoneme scoring (PHONEME_SCORING): {ctx.phoneme_note}", f"- {ctx.freeze.text}",
          f"- Target phrase (default): {ctx.phrase}"]
    if ctx.freeze.note:
        L.append(f"- Note: {ctx.freeze.note}")
    if ctx.mode == "validate" and ctx.freeze.state != "yes":
        L += ["", "> WARNING: thresholds are not verifiably frozen for this run, so it is NOT independent evidence."]
    if ctx.mode == "all":
        L += ["", "> ALL DATA: NOT independent evidence. Tuning and validation people are pooled; use `--mode validate` after `--freeze`."]

    L += ["", "## Dataset", ""]
    rows = [[s, str(ctx.clip_counts.get(s, 0)), str(ctx.subject_counts.get(s, 0)),
             str(sum(1 for r in ctx.runs if r.split == s and r.scored)), str(sum(1 for r in ctx.runs if r.split == s and r.retry))] for s in SPLITS]
    rows.append(["total", str(sum(ctx.clip_counts.values())), str(sum(ctx.subject_counts.values())),
                 str(sum(1 for r in ctx.runs if r.scored)), str(sum(1 for r in ctx.runs if r.retry))])
    L += _table(["split", "labelled runs", "subjects", "scored (analyzed)", "retries (analyzed)"], rows)
    L += ["", f"Unlabeled clips excluded: {ctx.excluded_unlabeled}. Clips with no subject in the sidecar or filename (folder name used): {ctx.no_subject}."]
    if ctx.mode != "all":
        other = "tune" if ctx.mode == "validate" else "validate"
        L.append(f"The {other} split was not analyzed in this mode (counts above are from discovery).")
    for w in ctx.warnings:
        L.append(f"Warning: {w}")

    L += ["", "## Environment", ""]
    envs = Counter(env_key(r) for r in runs)
    L += _table(["environment (browser/OS, device, sample rate, audio processing)", "runs"], [[k, str(v)] for k, v in sorted(envs.items(), key=lambda kv: (-kv[1], kv[0]))] or [["-", "0"]])

    if ctx.mode in ("validate", "all"):
        crits = criteria(runs)
        verdict = overall(crits)
        L += ["", f"## Acceptance criteria ({'validation split' if ctx.mode == 'validate' else 'ALL DATA, not independent'})", ""]
        L.append(f"**Overall: {verdict}**" + (f" ({', '.join(c.name for c in crits if c.status == FAIL)})" if verdict == FAIL else
                                            f" ({', '.join(c.name for c in crits if c.status == INSUFFICIENT)} need more data)" if verdict == INSUFFICIENT else ""))
        if verdict == INSUFFICIENT:
            L += ["", "> **INSUFFICIENT DATA: this run does not prove accuracy yet** (see the criteria below for how much more is needed)."]
        L.append("")
        crows = []
        for c in crits:
            interval = f"upper {_pct(c.hi)} (one-sided 95%)" if c.kind == "one-sided upper" and math.isfinite(c.hi) else _interval(c.lo, c.hi) + " (95%)" if math.isfinite(c.lo) else "-"
            crows.append([c.name, c.status, _kn(c.k, c.n), _pct(c.rate), interval, c.requirement + (f"; {c.detail}" if c.detail else "")])
        L += _table(["criterion", "status", "k/n", "rate", "interval", "requirement / note"], crows)
        L += ["", "falseAlarm is nearly vacuous for speech: the speech result alone reaches the alert threshold only at severity x confidence = 1.0 "
              f"(risk = 1 - (1 - {cal.SPEECH_MAX_WEIGHT}*severity*confidence) >= {cal.RISK_THRESHOLD}). `healthyAnchor` (healthy severity <= {HEALTHY_ANCHOR_SEVERITY}) is the meaningful false-alarm guard for speech.",
              "sideAccuracy does not apply to speech."]
        for c in crits:
            if c.status == INSUFFICIENT:
                L.append(f"INSUFFICIENT DATA: {c.name}: {_kn(c.k, c.n)}; {c.detail}.")

    L += ["", "## Per-condition breakdown (healthy anchor and deficit detection, non-retry)", ""]
    grows = []
    for g in condition_breakdown(runs):
        lo, hi = wilson(g.healthy_ok, g.healthy_n)
        healthy_cell = f"{_kn(g.healthy_ok, g.healthy_n)} ({_pct(_rate(g.healthy_ok, g.healthy_n))}) {_interval(lo, hi)}" if g.healthy_n else "-"
        deficit_cell = f"{_kn(g.deficit_hit, g.deficit_n)} ({_pct(_rate(g.deficit_hit, g.deficit_n))})" if g.deficit_n else "-"
        grows.append([g.key, g.value, str(g.runs), str(g.retries), healthy_cell, deficit_cell, g.warning])
    L += _table(["condition", "value", "runs", "retries", f"healthy severity <= {HEALTHY_ANCHOR_SEVERITY}", f"deficit severity >= {DEFICIT_SEVERITY}", "warning"], grows or [["-"] * 7])

    L += ["", "## Per-scenario", ""]
    L += _table(["scenario", "expected", "runs", "pass", "retries", "severity mean [min-max]", "alerts"], scenario_rows(runs) or [["-"] * 7])

    L += ["", "## Retry reasons (flags[0] of retry runs)", ""]
    hist = Counter(r.retry_reason for r in runs if r.retry)
    L += _table(["reason", "count"], [[k, str(v)] for k, v in sorted(hist.items(), key=lambda kv: (-kv[1], kv[0]))] or [["(no retries)", "0"]])

    L += ["", "## Threshold sweep (non-retry; fraction of runs at severity >= cutoff)", ""]
    tune_runs = [r for r in ctx.runs if r.split == "tune"] if ctx.mode in ("tune", "all") else None
    val_runs = [r for r in ctx.runs if r.split == "validate"] if ctx.mode in ("validate", "all") else None
    L += _table(["cutoff", "tune healthy >= (false alarms)", "tune deficit >= (detected)", "validate healthy >=", "validate deficit >="],
                [[f"{s.cutoff:.2f}", _cell(s.tune_healthy), _cell(s.tune_deficit), _cell(s.validate_healthy), _cell(s.validate_deficit)]
                 for s in sweep(tune_runs, val_runs)])

    L += ["", "## Ramp suggestions (tune split, non-retry; NEVER auto-applied)", ""]
    if tune_runs is None:
        L.append("Not computed in validate mode: ramp suggestions use the tune split only (run `--mode tune`).")
    else:
        rrows = []
        for s in ramp_suggestions(tune_runs):
            cur = "-" if s.current is None else f"{s.current[0]:g} -> {s.current[1]:g}"
            if s.wrong_way:
                cur += " WRONG WAY"
            if not s.direction:
                rrows.append([s.metric, f"{s.n_healthy}/{s.n_deficit}", "-", "-", "-", "-", "-", s.note, cur])
                continue
            rrows.append([s.metric, f"{s.n_healthy}/{s.n_deficit}", s.direction, _num(s.normal_edge), _num(s.abnormal_edge),
                          _f2(s.auc), _num(s.d), s.label + (f" ({s.note})" if s.note else ""), cur])
        L += _table(["metric", "n healthy/deficit", "direction", "suggested normal", "suggested abnormal", "AUC", "d", "separation", "current ramp"],
                    rrows or [["(no metrics)"] + ["-"] * 8])
        L += ["", "normal = 90th percentile of healthy (10th if lower is worse); abnormal = median of deficit; percentiles use linear interpolation. "
              "AUC = P(deficit > healthy), ties 0.5; d = Cohen's d (deficit - healthy)."]

    L += ["", "## Failing runs", ""]
    bad = failing_runs(runs)
    if not bad:
        L.append("(none)")
    for i, r in enumerate(bad[:200], 1):
        why = r.problem or "no reason"
        if public:
            L.append(f"- run {i} [{r.scenario}, {r.split}, expected {r.expected}]: {'analyzer error' if r.error else why}")
        else:
            L.append(f"- {r.path} (subject {r.subject}, {r.split}) [{r.scenario}, expected {r.expected}]: {why}")
    if len(bad) > 200:
        L.append(f"- ... and {len(bad) - 200} more")

    L += ["", DISCLAIMER, ""]
    return "\n".join(L)


def render_full(ctx: ReportContext) -> str:
    """stdout rendering: includes file names and subject names."""
    return render(ctx, public=False)


def render_public(ctx: ReportContext) -> str:
    """Committable rendering: counts, rates, intervals and conditions only; no subject names, no file names."""
    return render(ctx, public=True)


# ---------- CLI ----------

def _default_analyzer() -> Analyzer:
    from models.audio import analyze_speech  # lazy: keeps this module importable (and testable) without the DSP stack

    return analyze_speech


def main(argv: Sequence[str] | None = None, analyzer: Analyzer | None = None, out: TextIO | None = None) -> int:
    out = out or sys.stdout
    parser = argparse.ArgumentParser(prog="python -m models.validate", description="Held-out validation of speech scoring.")
    parser.add_argument("--mode", choices=("validate", "tune", "all"), default="validate")
    parser.add_argument("--dir", action="append", type=Path, dest="dirs", help="directory of WAVs (repeatable; replaces the defaults)")
    parser.add_argument("--split-file", type=Path, help='JSON {"tune": [...], "validate": [...]} overriding the hash split (default: split.json in each --dir)')
    parser.add_argument("--out", type=Path, help="write the PUBLIC report (no subject/file names) to this markdown file")
    parser.add_argument("--freeze", action="store_true", help="record the current thresholds hash in docs/validation/frozen-speech.json and exit")
    parser.add_argument("--freeze-file", type=Path, default=FREEZE_PATH, help=argparse.SUPPRESS)
    parser.add_argument("--phrase", default=config.TARGET_PHRASE, help="target phrase when a clip has none (default: config TARGET_PHRASE)")
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return int(exc.code) if isinstance(exc.code, int) else 2

    if args.freeze:
        try:
            payload = write_freeze(args.freeze_file)
        except OSError as exc:
            print(f"error: could not write {args.freeze_file}: {exc}", file=sys.stderr)
            return 2
        print(f"Frozen speech thresholds: hash {payload['hash']} at commit {payload['gitCommit'] or 'unknown'} -> {args.freeze_file}", file=out)
        print("Now run `python -m models.validate` (validate mode) ONCE on the held-out split. Any later config change invalidates the freeze.", file=out)
        return 0

    if args.dirs:
        missing = [d for d in args.dirs if not d.is_dir()]
        if missing:
            print(f"error: not a directory: {', '.join(str(d) for d in missing)}", file=sys.stderr)
            return 2
        dirs: Sequence[Path] = args.dirs
    else:
        dirs = cal.DEFAULT_DIRS

    try:
        split_paths = [args.split_file] if args.split_file else [d / "split.json" for d in dirs]
        override = load_split_override(split_paths, explicit=bool(args.split_file))
    except (SplitError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    clips = cal.discover(dirs, args.phrase)
    if not clips:
        print(f"error: no .wav files found in: {', '.join(str(d) for d in dirs)}\n"
              "Add consented clips under tests/fixtures/audio/{normal,slurred}/ or record with the browser's ?record=1 mode.", file=sys.stderr)
        return 2

    labelled: list[tuple[cal.Clip, str, str, str, dict]] = []  # clip, subject, source, split, sidecar
    unlabeled = 0
    for clip in clips:
        if clip.expected is None:
            unlabeled += 1
            continue
        side, _ = load_sidecar(clip.path)
        subject, source = resolve_subject(clip, side)
        labelled.append((clip, subject, source, split_for(subject, override), side))
    if not labelled:
        print(f"error: none of the {len(clips)} clips is labelled (sidecar `expected`, or normal/ slurred/ folders).", file=sys.stderr)
        return 2

    wanted = SPLITS if args.mode == "all" else (args.mode,)
    todo = [item for item in labelled if item[3] in wanted]
    try:
        rows = cal.run_clips([item[0] for item in todo], analyzer or _default_analyzer())
    except ImportError as exc:
        print(f"error: could not import the speech analyzer: {exc}", file=sys.stderr)
        return 2
    runs = [run_from_row(row, subj, src, split, side) for row, (_, subj, src, split, side) in zip(rows, todo)]

    on, note = phoneme_scoring_status()
    ctx = ReportContext(
        mode=args.mode, runs=runs,
        clip_counts={s: sum(1 for item in labelled if item[3] == s) for s in SPLITS},
        subject_counts={s: len({normalize_subject(item[1]) for item in labelled if item[3] == s}) for s in SPLITS},
        excluded_unlabeled=unlabeled, generated=dt.date.today().isoformat(), commit=git_commit(),
        phoneme_on=on, phoneme_note=note, freeze=freeze_status(args.freeze_file),
        split_note=("deterministic sha1(subject) bucket (< 60 tune, else validate)" + (f" with override for {len(override)} subject(s)" if override else "")),
        phrase=args.phrase, no_subject=sum(1 for item in labelled if item[2] == "folder"),
        warnings=[f"{sum(1 for c in clips if c.warning)} clip(s) had sidecar warnings (bad JSON / invalid `expected`); see models.calibrate"] if any(c.warning for c in clips) else [],
    )
    print(render_full(ctx), file=out)

    if args.out:
        try:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(render_public(ctx), encoding="utf-8")
        except OSError as exc:
            print(f"error: could not write report: {exc}", file=sys.stderr)
            return 2
        print(f"\nPublic report written to {args.out}", file=out)

    if args.mode == "validate":
        crits = criteria(ctx.evaluated())
        return 1 if overall(crits) == FAIL else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
