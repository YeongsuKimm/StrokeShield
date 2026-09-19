// Offline replay: re-score recordings through the SAME pure analyzers the app uses, judge them against the shared
// severity anchors (docs/spec/02-vision.md "Shared conventions"), and summarize. Pure: no DOM, no fs.
import type { TestResult } from '../contracts'
import { computeRisk } from '../risk'
import { analyzeArms } from '../vision/arms'
import { analyzeEyes } from '../vision/eyes'
import { analyzeFace } from '../vision/face'
import type { Conditions, Expected, ExpectedSide, Recording, RecordingEnv, RecordingKind } from './recording'
import { splitFor, type Split, type SplitOverride } from './split'

/** Severity bands every analyzer is calibrated to. Change only together with the specs + consistency.test.ts. */
export const ANCHORS = {
  healthyMax: 0.15, // healthy people incl. natural asymmetry
  borderlineMin: 0.2,
  borderlineMax: 0.55, // "≈ 0.3–0.4" with room for noise
  deficitMin: 0.85, // clear one-sided deficit
} as const

export function replay(rec: Recording): TestResult {
  const i = rec.inputs
  switch (i.kind) {
    case 'face':
      return analyzeFace(i.neutral, i.smile)
    case 'arms':
      return analyzeArms(i.frames, { aspectRatio: i.aspectRatio })
    case 'eyes':
      return analyzeEyes(i.frames, { aspect: i.aspect })
  }
}

/** Would this single result trigger the alert on its own (risk score, spec 05)? */
export const wouldAlert = (r: TestResult): boolean => !r.needsRetry && computeRisk({ [r.test]: r }).triggered

export interface Verdict {
  ok: boolean
  /** The analyzer refused to score (needsRetry). Counted separately from failures. */
  retry: boolean
  reason: string
}

export function evaluate(rec: Pick<Recording, 'expected' | 'expectedSide'>, r: TestResult): Verdict {
  if (r.needsRetry) return { ok: false, retry: true, reason: `retry: ${r.flags[0] ?? 'no reason given'}` }
  const sev = r.severity
  const alert = wouldAlert(r)
  const problems: string[] = []
  if (rec.expected === 'healthy') {
    if (sev > ANCHORS.healthyMax) problems.push(`severity ${sev.toFixed(2)} > ${ANCHORS.healthyMax} for a healthy run`)
    if (alert) problems.push('FALSE ALARM: would trigger the alert')
  } else if (rec.expected === 'borderline') {
    if (sev < ANCHORS.borderlineMin || sev > ANCHORS.borderlineMax) problems.push(`severity ${sev.toFixed(2)} outside ${ANCHORS.borderlineMin}-${ANCHORS.borderlineMax}`)
    if (alert) problems.push('borderline run would trigger the alert')
  } else {
    if (sev < ANCHORS.deficitMin) problems.push(`MISSED: severity ${sev.toFixed(2)} < ${ANCHORS.deficitMin} for a clear deficit`)
    if (rec.expectedSide !== 'none' && r.side !== rec.expectedSide) problems.push(`wrong side: got ${r.side ?? 'none'}, expected ${rec.expectedSide}`)
  }
  return { ok: problems.length === 0, retry: false, reason: problems.join('; ') || 'ok' }
}

export interface Row {
  file: string
  subject: string
  kind: RecordingKind
  scenario: string
  expected: Expected
  expectedSide: ExpectedSide
  result: TestResult
  /** Severity the live app computed when recording (differs from `result` after threshold changes). */
  liveSeverity: number
  verdict: Verdict
  alert: boolean
  /** tune / validate (deterministic by subject, see split.ts; `override` = recordings/split.json). */
  split: Split
  conditions?: Conditions
  env?: RecordingEnv
}

export function analyzeRow(rec: Recording, file: string, override?: SplitOverride | null): Row {
  const result = replay(rec)
  return {
    file,
    subject: rec.subject,
    kind: rec.inputs.kind,
    scenario: rec.scenario,
    expected: rec.expected,
    expectedSide: rec.expectedSide,
    result,
    liveSeverity: rec.liveResult?.severity ?? NaN,
    verdict: evaluate(rec, result),
    alert: wouldAlert(result),
    split: splitFor(rec.subject, override),
    conditions: rec.conditions,
    env: rec.env,
  }
}

export interface Summary {
  kind: RecordingKind
  scenario: string
  expected: Expected
  n: number
  pass: number
  retries: number
  sevMean: number
  sevMin: number
  sevMax: number
  alerts: number
  sideCorrect: number
  sideChecked: number
}

export function summarize(rows: Row[]): Summary[] {
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const key = `${r.kind}|${r.scenario}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  return [...groups.values()]
    .map((g) => {
      const scored = g.filter((r) => !r.verdict.retry)
      const sev = scored.map((r) => r.result.severity)
      const sided = scored.filter((r) => r.expectedSide !== 'none')
      return {
        kind: g[0].kind,
        scenario: g[0].scenario,
        expected: g[0].expected,
        n: g.length,
        pass: g.filter((r) => r.verdict.ok).length,
        retries: g.length - scored.length,
        sevMean: sev.length ? sev.reduce((a, b) => a + b, 0) / sev.length : NaN,
        sevMin: sev.length ? Math.min(...sev) : NaN,
        sevMax: sev.length ? Math.max(...sev) : NaN,
        alerts: scored.filter((r) => r.alert).length,
        sideCorrect: sided.filter((r) => r.result.side === r.expectedSide).length,
        sideChecked: sided.length,
      }
    })
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.expected.localeCompare(b.expected) || a.scenario.localeCompare(b.scenario))
}

const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : '  - ')
const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length))

export function formatTable(rows: Row[]): string {
  const sums = summarize(rows)
  const head = `${pad('test', 6)}${pad('scenario', 32)}${pad('expect', 11)}${pad('n', 4)}${pad('pass', 6)}${pad('retry', 7)}${pad('severity mean [min-max]', 26)}${pad('alerts', 8)}side ok`
  const lines = [head, '-'.repeat(head.length + 4)]
  for (const s of sums) {
    lines.push(
      `${pad(s.kind, 6)}${pad(s.scenario, 32)}${pad(s.expected, 11)}${pad(String(s.n), 4)}${pad(`${s.pass}/${s.n}`, 6)}${pad(String(s.retries), 7)}${pad(`${f2(s.sevMean)} [${f2(s.sevMin)}-${f2(s.sevMax)}]`, 26)}${pad(`${s.alerts}/${s.n - s.retries}`, 8)}${s.sideChecked ? `${s.sideCorrect}/${s.sideChecked}` : '-'}`,
    )
  }
  const scored = rows.filter((r) => !r.verdict.retry)
  const healthy = scored.filter((r) => r.expected === 'healthy')
  const deficit = scored.filter((r) => r.expected === 'deficit')
  const detected = deficit.filter((r) => r.result.severity >= ANCHORS.deficitMin)
  lines.push(
    '',
    `Runs: ${rows.length} (${rows.length - scored.length} retries = ${rows.length ? Math.round(((rows.length - scored.length) / rows.length) * 100) : 0}%)`,
    `False alarms on healthy runs: ${healthy.filter((r) => r.alert).length}/${healthy.length}`,
    `Clear deficits detected (severity >= ${ANCHORS.deficitMin}): ${detected.length}/${deficit.length}`,
  )
  return lines.join('\n')
}

export function formatFailures(rows: Row[]): string[] {
  return rows
    .filter((r) => !r.verdict.ok)
    .map((r) => `${r.verdict.retry ? 'RETRY ' : 'FAIL  '}${r.file} [${r.scenario}] ${r.verdict.reason}`)
}
