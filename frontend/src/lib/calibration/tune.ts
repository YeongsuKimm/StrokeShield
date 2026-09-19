// Tuning aids computed on the TUNE split only: ramp-edge suggestions per metric (never auto-applied) and a severity
// cutoff sweep. Pure: rows in, text/numbers out. Shared spec with the Python speech validator.
import { ARMS_CONFIG } from '../vision/arms'
import { EYES_CONFIG } from '../vision/eyes'
import { FACE_CONFIG } from '../vision/face'
import type { RecordingKind } from './recording'
import type { Row } from './replay'
import { auc, cohensD, fmt, fmtPct, median, percentile } from './stats'

export type Direction = 'higher is worse' | 'lower is worse'
export type Strength = 'strong' | 'moderate' | 'weak'

export interface RampSuggestion {
  kind: RecordingKind
  metric: string
  nHealthy: number
  nDeficit: number
  direction: Direction
  medianHealthy: number
  medianDeficit: number
  /** Suggested `lo` (normal) edge: healthy p90 (p10 when lower is worse). */
  normalEdge: number
  /** Suggested `hi` (abnormal) edge: median of the deficit runs. */
  abnormalEdge: number
  auc: number
  cohensD: number
  strength: Strength
  /** False when the edges are inverted or touching: the metric does not separate the groups. */
  separated: boolean
  /** The ramp currently in the config for this metric, when known. */
  current?: { lo: number; hi: number }
  /** Fewer than 5 runs in a group: treat the edges as a guess. */
  lowN: boolean
}

/** Current ramps by `kind|metric`, where the config names them (only known ones are printed). */
export function currentRamps(): Record<string, { lo: number; hi: number }> {
  const out: Record<string, { lo: number; hi: number }> = {}
  for (const [metric, r] of Object.entries(FACE_CONFIG.ramps)) out[`face|${metric}`] = { lo: r.lo, hi: r.hi }
  out['arms|drift_asym'] = { ...ARMS_CONFIG.driftAsymRamp }
  out['arms|height_diff'] = { ...ARMS_CONFIG.heightDiffRamp }
  out['eyes|excursion_asym'] = { ...EYES_CONFIG.ramps.excursionAsym }
  out['eyes|conjugacy_err'] = { ...EYES_CONFIG.ramps.conjugacyErr }
  out['eyes|rest_deviation'] = { ...EYES_CONFIG.ramps.restDeviation }
  return out
}

export const strengthOf = (a: number): Strength => (a >= 0.9 || a <= 0.1 ? 'strong' : a >= 0.75 || a <= 0.25 ? 'moderate' : 'weak')

/** A ramp suggestion needs at least this many non-retry healthy AND deficit runs (tune split) for the metric. */
export const MIN_RAMP_RUNS = 2

const metricValues = (rows: Row[], metric: string): number[] =>
  rows.map((r) => r.result.metrics[metric]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))

/** Ramp suggestions per (kind, metric). Uses ONLY rows of the tune split, non-retry, healthy vs deficit. */
export function rampSuggestions(rows: Row[]): RampSuggestion[] {
  const usable = rows.filter((r) => r.split === 'tune' && !r.verdict.retry)
  const known = currentRamps()
  const out: RampSuggestion[] = []
  for (const kind of ['face', 'arms', 'eyes'] as const) {
    const ofKind = usable.filter((r) => r.kind === kind)
    const healthy = ofKind.filter((r) => r.expected === 'healthy')
    const deficit = ofKind.filter((r) => r.expected === 'deficit')
    const names = new Set(ofKind.flatMap((r) => Object.keys(r.result.metrics)))
    for (const metric of [...names].sort()) {
      const h = metricValues(healthy, metric)
      const d = metricValues(deficit, metric)
      if (h.length < MIN_RAMP_RUNS || d.length < MIN_RAMP_RUNS) continue // "insufficient data", reported per kind by rampInsufficiency()
      const medH = median(h)
      const medD = median(d)
      const higher = medD > medH
      const normalEdge = higher ? percentile(h, 0.9) : percentile(h, 0.1)
      const abnormalEdge = medD
      const a = auc(d, h)
      out.push({
        kind,
        metric,
        nHealthy: h.length,
        nDeficit: d.length,
        direction: higher ? 'higher is worse' : 'lower is worse',
        medianHealthy: medH,
        medianDeficit: medD,
        normalEdge,
        abnormalEdge,
        auc: a,
        cohensD: cohensD(d, h),
        strength: strengthOf(a),
        separated: higher ? normalEdge < abnormalEdge : normalEdge > abnormalEdge,
        current: known[`${kind}|${metric}`],
        lowN: h.length < 5 || d.length < 5,
      })
    }
  }
  return out.sort((x, y) => x.kind.localeCompare(y.kind) || Math.abs(y.auc - 0.5) - Math.abs(x.auc - 0.5) || x.metric.localeCompare(y.metric))
}

export interface RampInsufficiency {
  kind: RecordingKind
  nHealthy: number
  nDeficit: number
}

/** Test kinds that have tune-split runs but not enough non-retry healthy AND deficit runs for any suggestion. */
export function rampInsufficiency(rows: Row[]): RampInsufficiency[] {
  const usable = rows.filter((r) => r.split === 'tune' && !r.verdict.retry)
  const out: RampInsufficiency[] = []
  for (const kind of ['face', 'arms', 'eyes'] as const) {
    const ofKind = usable.filter((r) => r.kind === kind)
    const nHealthy = ofKind.filter((r) => r.expected === 'healthy').length
    const nDeficit = ofKind.filter((r) => r.expected === 'deficit').length
    if (rows.some((r) => r.split === 'tune' && r.kind === kind) && (nHealthy < MIN_RAMP_RUNS || nDeficit < MIN_RAMP_RUNS)) out.push({ kind, nHealthy, nDeficit })
  }
  return out
}

export function formatRampSuggestions(list: RampSuggestion[], insufficient: RampInsufficiency[] = []): string {
  const lines: string[] = insufficient.map(
    (i) => `${i.kind.padEnd(5)} insufficient data: need >= ${MIN_RAMP_RUNS} healthy AND >= ${MIN_RAMP_RUNS} deficit non-retry runs in the tune split (have ${i.nHealthy} healthy, ${i.nDeficit} deficit)`,
  )
  if (!list.length && !insufficient.length) return 'insufficient data: need healthy AND deficit runs (non-retry) in the tune split.'
  for (const s of list) {
    const verdict = s.separated ? `suggest lo=${fmt(s.normalEdge, 3)} (healthy ${s.direction === 'higher is worse' ? 'p90' : 'p10'}), hi=${fmt(s.abnormalEdge, 3)} (deficit median)` : 'no useful separation'
    const cur = s.current ? `; current lo=${s.current.lo} hi=${s.current.hi}` : ''
    lines.push(
      `${s.kind.padEnd(5)} ${s.metric.padEnd(22)} ${s.direction.padEnd(15)} AUC ${fmt(s.auc)} d ${fmt(s.cohensD)} [${s.strength}] n=${s.nHealthy}h/${s.nDeficit}d${s.lowN ? ' (few runs)' : ''}: ${verdict}${cur}`,
    )
  }
  return lines.join('\n')
}

export const SWEEP_CUTOFFS: readonly number[] = Array.from({ length: 18 }, (_, i) => Math.round((0.1 + i * 0.05) * 100) / 100) // 0.10 .. 0.95

export interface SweepRow {
  cutoff: number
  healthyN: number
  /** Healthy runs with severity >= cutoff (false positives). */
  healthyHits: number
  deficitN: number
  /** Deficit runs with severity >= cutoff (detections). */
  deficitHits: number
}

/** Severity-cutoff sweep on non-retry runs (`result.severity`). */
export function sweep(rows: Row[]): SweepRow[] {
  const scored = rows.filter((r) => !r.verdict.retry)
  const h = scored.filter((r) => r.expected === 'healthy').map((r) => r.result.severity)
  const d = scored.filter((r) => r.expected === 'deficit').map((r) => r.result.severity)
  return SWEEP_CUTOFFS.map((cutoff) => ({
    cutoff,
    healthyN: h.length,
    healthyHits: h.filter((s) => s >= cutoff).length,
    deficitN: d.length,
    deficitHits: d.filter((s) => s >= cutoff).length,
  }))
}

const cell = (k: number, n: number): string => (n > 0 ? `${k}/${n} (${fmtPct(k / n, 0)})` : '-')

/** Markdown table: false-positive and detection rate per cutoff, tune and (optionally) validate side by side. */
export function formatSweep(tune: Row[], validate?: Row[]): string {
  const t = sweep(tune)
  const v = validate ? sweep(validate) : null
  const head = v
    ? '| cutoff | tune false-pos | tune detected | validate false-pos | validate detected |\n|---|---|---|---|---|'
    : '| cutoff | tune false-pos | tune detected |\n|---|---|---|'
  const lines = t.map((row, i) => {
    const base = `| ${row.cutoff.toFixed(2)} | ${cell(row.healthyHits, row.healthyN)} | ${cell(row.deficitHits, row.deficitN)} |`
    return v ? `${base} ${cell(v[i].healthyHits, v[i].healthyN)} | ${cell(v[i].deficitHits, v[i].deficitN)} |` : base
  })
  return [head, ...lines].join('\n')
}
