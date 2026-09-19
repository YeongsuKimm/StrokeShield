// "The numbers behind each check": turns the metrics the analyzers already return into a few plain-word rows per
// check. PURE: no DOM, no network, no globals. Numbers and words only; nothing here keeps or replays video.
//
// Left and right are the PATIENT's left and right (the analyzers report them that way, see spec 02). Every value is a
// measurement, never a verdict: no severities, no thresholds, no "normal" or "abnormal".
import { MEASURED_COPY as C } from './copy/features'
import type { TestName, TestResult } from './contracts'

export interface MeasuredRow {
  label: string
  value: string
}

export interface MeasuredCheck {
  test: TestName
  name: string
  status: 'measured' | 'not_measured'
  /** Why nothing is shown (only when status is 'not_measured'). */
  reason?: string
  rows: MeasuredRow[]
}

type Metrics = Record<string, number>
const num = (m: Metrics, key: string): number | undefined => {
  const v = m[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}
const fixed = (v: number, digits: number): string => {
  const s = Math.abs(v).toFixed(digits)
  return Number(s) === 0 ? (0).toFixed(digits) : (v < 0 ? '-' : '') + s // never "-0.0"
}
const pct = (ratio: number): string => `${Math.round(ratio * 100)}`

function faceRows(m: Metrics): MeasuredRow[] {
  const rows: MeasuredRow[] = []
  const left = num(m, 'lift_left')
  const right = num(m, 'lift_right')
  if (left !== undefined) rows.push({ label: C.face.leftLift, value: C.face.unitLift(fixed(left * 100, 1)) })
  if (right !== undefined) rows.push({ label: C.face.rightLift, value: C.face.unitLift(fixed(right * 100, 1)) })
  const asym = num(m, 'lift_asym')
  if (asym !== undefined) rows.push({ label: C.face.difference, value: `${pct(asym)}%` })
  return rows
}

/** theta is degrees above the horizontal: 0 is level, negative is below. drift > 0 means the arm went down. */
function armRow(label: string, lowest: number | undefined, drift: number | undefined): MeasuredRow | null {
  const bits: string[] = []
  if (lowest !== undefined) {
    const deg = C.arms.degrees(fixed(Math.abs(lowest), 0))
    bits.push(C.arms.lowest(Number.parseFloat(deg) === 0 ? C.arms.level : lowest > 0 ? C.arms.above(deg) : C.arms.below(deg)))
  }
  if (drift !== undefined) {
    const deg = C.arms.degrees(fixed(Math.abs(drift), 0))
    bits.push(C.arms.drift(Number.parseFloat(deg) === 0 ? C.arms.noDrift : drift > 0 ? C.arms.down(deg) : C.arms.up(deg)))
  }
  return bits.length ? { label, value: bits.join(', ') } : null
}

function armsRows(m: Metrics): MeasuredRow[] {
  const rows: MeasuredRow[] = []
  const left = armRow(C.arms.left, num(m, 'min_theta_left'), num(m, 'drift_left'))
  const right = armRow(C.arms.right, num(m, 'min_theta_right'), num(m, 'drift_right'))
  if (left) rows.push(left)
  if (right) rows.push(right)
  const gap = num(m, 'height_diff')
  if (gap !== undefined) rows.push({ label: C.arms.wristGap, value: C.arms.gapUnit(pct(gap)) })
  return rows
}

function eyesRows(m: Metrics): MeasuredRow[] {
  const rows: MeasuredRow[] = []
  const left = num(m, 'exc_left')
  const right = num(m, 'exc_right')
  // A side that could not be measured is NaN in the analyzer; say so instead of dropping it silently.
  rows.push({ label: C.eyes.left, value: left === undefined ? C.notMeasured : C.eyes.unit(fixed(left, 2)) })
  rows.push({ label: C.eyes.right, value: right === undefined ? C.notMeasured : C.eyes.unit(fixed(right, 2)) })
  if (left === undefined && right === undefined) return []
  const asym = num(m, 'excursion_asym')
  if (asym !== undefined && left !== undefined && right !== undefined) rows.push({ label: C.eyes.difference, value: `${pct(asym)}%` })
  return rows
}

function speechRows(m: Metrics): MeasuredRow[] {
  const rows: MeasuredRow[] = []
  const syllables = num(m, 'articulation_rate')
  const words = num(m, 'speech_rate_wps')
  if (syllables !== undefined) rows.push({ label: C.speech.rate, value: C.speech.rateSyllables(fixed(syllables, 1)) })
  else if (words !== undefined) rows.push({ label: C.speech.rate, value: C.speech.rateWords(fixed(words, 1)) })
  const count = num(m, 'n_pauses')
  const longest = num(m, 'longest_pause_s')
  if (count !== undefined && longest !== undefined) {
    const n = Math.round(count)
    const value = n === 0 ? C.speech.noPauses : n === 1 ? C.speech.pauseOne(fixed(longest, 1)) : C.speech.pausesValue(`${n}`, fixed(longest, 1))
    rows.push({ label: C.speech.pauses, value })
  }
  const snr = num(m, 'snr_db')
  if (snr !== undefined) rows.push({ label: C.speech.clarity, value: C.speech.clarityValue(fixed(snr, 0)) })
  return rows
}

const ROWS: Record<TestName, (m: Metrics) => MeasuredRow[]> = { face: faceRows, arms: armsRows, eyes: eyesRows, speech: speechRows }

/** One entry per check in `order`, in that order. Skipped, unclear or missing checks say "not measured", with the reason. */
export function measuredChecks(
  results: Partial<Record<TestName, TestResult>>,
  skipped: readonly TestName[],
  order: readonly TestName[],
): MeasuredCheck[] {
  return order.map((test): MeasuredCheck => {
    const name = C.checkNames[test]
    const result = results[test]
    if (skipped.includes(test)) return { test, name, status: 'not_measured', reason: C.reasonSkipped, rows: [] }
    if (!result) return { test, name, status: 'not_measured', reason: C.reasonNotRun, rows: [] }
    if (result.needsRetry) return { test, name, status: 'not_measured', reason: C.reasonUnclear, rows: [] }
    const rows = ROWS[test](result.metrics ?? {})
    if (rows.length === 0) return { test, name, status: 'not_measured', reason: C.reasonUnclear, rows: [] }
    return { test, name, status: 'measured', rows }
  })
}
