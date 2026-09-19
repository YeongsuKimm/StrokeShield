// Acceptance criteria for the VALIDATION split (shared spec with the Python speech validator). Each criterion yields
// PASS / FAIL / INSUFFICIENT DATA and never silently passes on a small n. Pure: rows in, results out.
import { ANCHORS, type Row } from './replay'
import { fmt, wilson, Z_95_ONE_SIDED, Z_95_TWO_SIDED, type Interval } from './stats'

/** All numbers in one place. Changing any of these changes what "accurate" means: do it deliberately and say so. */
export const CRITERIA = {
  falseAlarm: { minN: 60, maxUpper: 0.05, z: Z_95_ONE_SIDED }, // one-sided 95% Wilson UPPER bound of the alert rate on healthy runs
  healthyAnchor: { minN: 20, minRate: 0.95, maxSeverity: ANCHORS.healthyMax }, // healthy runs with severity <= 0.15
  deficitDetection: { minN: 20, minRate: 0.9, minSeverity: ANCHORS.deficitMin, z: Z_95_TWO_SIDED }, // deficit runs with severity >= 0.85
  sideAccuracy: { minN: 10, minRate: 1.0, z: Z_95_TWO_SIDED }, // non-retry deficit runs with an expected side: correct side
  retryRate: { minN: 20, maxRate: 0.2, z: Z_95_TWO_SIDED }, // retries / all runs
  borderlineNoAlert: { minN: 5 }, // borderline runs must never alert
} as const

export type Status = 'PASS' | 'FAIL' | 'INSUFFICIENT DATA'
export type CriterionId = 'falseAlarm' | 'healthyAnchor' | 'deficitDetection' | 'sideAccuracy' | 'retryRate' | 'borderlineNoAlert'

export interface CriterionResult {
  id: CriterionId
  title: string
  status: Status
  /** Numerator / denominator of the rate the criterion is about (see `what`). */
  k: number
  n: number
  rate: number
  /** Wilson bounds (one-sided z=1.645 for falseAlarm, healthyAnchor lower; two-sided 95% otherwise). */
  interval: Interval
  intervalLabel: string
  /** What k counts, e.g. "healthy runs that would alert". */
  what: string
  target: string
  /** Extra explanation, e.g. how many more runs are needed. */
  note: string
}

const nonRetry = (rows: Row[]): Row[] => rows.filter((r) => !r.verdict.retry)

/** Smallest number of ADDITIONAL healthy runs (assuming no further alarms) after which the one-sided upper bound is < maxUpper and n >= minN. null if hopeless. */
export function healthyRunsNeeded(k: number, n: number): number | null {
  const { minN, maxUpper, z } = CRITERIA.falseAlarm
  for (let total = Math.max(n, minN); total <= 100_000; total++) {
    if (wilson(k, total, z).hi < maxUpper) return total - n
  }
  return null
}

const rateOf = (k: number, n: number): number => (n > 0 ? k / n : NaN)

export function evaluateCriteria(rows: Row[]): CriterionResult[] {
  const scored = nonRetry(rows)
  const healthy = scored.filter((r) => r.expected === 'healthy')
  const deficit = scored.filter((r) => r.expected === 'deficit')
  const borderline = scored.filter((r) => r.expected === 'borderline')
  const sided = deficit.filter((r) => r.expectedSide !== 'none')
  const out: CriterionResult[] = []

  // 1. false alarms on healthy runs
  {
    const c = CRITERIA.falseAlarm
    const n = healthy.length
    const k = healthy.filter((r) => r.alert).length
    const w = wilson(k, n, c.z)
    let status: Status
    if (n > 0 && w.lo >= c.maxUpper) status = 'FAIL' // provably above 5 % even with few runs
    else if (n >= c.minN) status = w.hi < c.maxUpper ? 'PASS' : 'FAIL'
    else status = 'INSUFFICIENT DATA'
    const need = healthyRunsNeeded(k, n)
    const needText = need === null ? 'no amount of alarm-free runs can bring it below 5 %' : need === 0 ? 'enough runs already' : `${need} more healthy runs with no further alarms would bring the upper bound below 5 %`
    out.push({
      id: 'falseAlarm',
      title: 'False alarms on healthy runs',
      status,
      k,
      n,
      rate: rateOf(k, n),
      interval: w,
      intervalLabel: `upper bound ${fmt(w.hi, 4)} (one-sided 95%)`,
      what: 'healthy runs that would trigger the alert',
      target: `n >= ${c.minN} and upper bound < ${c.maxUpper}`,
      note: status === 'PASS' ? '' : needText,
    })
  }

  // 2. healthy runs inside the healthy severity anchor
  {
    const c = CRITERIA.healthyAnchor
    const n = healthy.length
    const k = healthy.filter((r) => r.result.severity <= c.maxSeverity).length
    const w = wilson(k, n, Z_95_TWO_SIDED)
    const rate = rateOf(k, n)
    out.push({
      id: 'healthyAnchor',
      title: `Healthy runs with severity <= ${c.maxSeverity}`,
      status: n < c.minN ? 'INSUFFICIENT DATA' : rate >= c.minRate ? 'PASS' : 'FAIL',
      k,
      n,
      rate,
      interval: w,
      intervalLabel: `95% CI [${fmt(w.lo, 4)}, ${fmt(w.hi, 4)}]`,
      what: `healthy runs with severity <= ${c.maxSeverity}`,
      target: `n >= ${c.minN} and observed >= ${c.minRate}`,
      note: n < c.minN ? `${c.minN - n} more healthy runs needed` : '',
    })
  }

  // 3. deficit detection
  {
    const c = CRITERIA.deficitDetection
    const n = deficit.length
    const k = deficit.filter((r) => r.result.severity >= c.minSeverity).length
    const w = wilson(k, n, c.z)
    const rate = rateOf(k, n)
    out.push({
      id: 'deficitDetection',
      title: `Mimicked deficits with severity >= ${c.minSeverity}`,
      status: n < c.minN ? 'INSUFFICIENT DATA' : rate >= c.minRate ? 'PASS' : 'FAIL',
      k,
      n,
      rate,
      interval: w,
      intervalLabel: `95% CI [${fmt(w.lo, 4)}, ${fmt(w.hi, 4)}]`,
      what: `deficit runs with severity >= ${c.minSeverity}`,
      target: `n >= ${c.minN} and observed >= ${c.minRate}`,
      note: n < c.minN ? `${c.minN - n} more deficit runs needed` : '',
    })
  }

  // 4. side accuracy
  {
    const c = CRITERIA.sideAccuracy
    const n = sided.length
    const k = sided.filter((r) => r.result.side === r.expectedSide).length
    const w = wilson(k, n, c.z)
    out.push({
      id: 'sideAccuracy',
      title: 'Correct side on mimicked one-sided deficits',
      status: n < c.minN ? 'INSUFFICIENT DATA' : k === n ? 'PASS' : 'FAIL',
      k,
      n,
      rate: rateOf(k, n),
      interval: w,
      intervalLabel: `95% CI [${fmt(w.lo, 4)}, ${fmt(w.hi, 4)}]`,
      what: 'deficit runs (with an expected side) reporting the correct side',
      target: `n >= ${c.minN} and observed = 1.0`,
      note: n < c.minN ? `${c.minN - n} more sided deficit runs needed` : '',
    })
  }

  // 5. retry rate (all runs, retries included)
  {
    const c = CRITERIA.retryRate
    const n = rows.length
    const k = rows.length - scored.length
    const w = wilson(k, n, c.z)
    const rate = rateOf(k, n)
    out.push({
      id: 'retryRate',
      title: 'Retry rate (runs the test refused to score)',
      status: n < c.minN ? 'INSUFFICIENT DATA' : rate <= c.maxRate ? 'PASS' : 'FAIL',
      k,
      n,
      rate,
      interval: w,
      intervalLabel: `95% CI [${fmt(w.lo, 4)}, ${fmt(w.hi, 4)}]`,
      what: 'retries among all runs',
      target: `n >= ${c.minN} and observed <= ${c.maxRate}`,
      note: n < c.minN ? `${c.minN - n} more runs needed` : '',
    })
  }

  // 6. borderline runs must not alert
  {
    const c = CRITERIA.borderlineNoAlert
    const n = borderline.length
    const k = borderline.filter((r) => r.alert).length
    const w = wilson(k, n, Z_95_TWO_SIDED)
    out.push({
      id: 'borderlineNoAlert',
      title: 'Borderline runs that alert',
      status: k > 0 ? 'FAIL' : n >= c.minN ? 'PASS' : 'INSUFFICIENT DATA',
      k,
      n,
      rate: rateOf(k, n),
      interval: w,
      intervalLabel: `95% CI [${fmt(w.lo, 4)}, ${fmt(w.hi, 4)}]`,
      what: 'borderline runs that would trigger the alert',
      target: `none alert (n >= ${c.minN})`,
      note: k === 0 && n < c.minN ? `${c.minN - n} more borderline runs needed` : '',
    })
  }
  return out
}

export const overallStatus = (results: CriterionResult[]): Status =>
  results.some((r) => r.status === 'FAIL') ? 'FAIL' : results.some((r) => r.status === 'INSUFFICIENT DATA') ? 'INSUFFICIENT DATA' : 'PASS'
