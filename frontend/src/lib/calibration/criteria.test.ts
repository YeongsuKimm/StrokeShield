import { describe, expect, it } from 'vitest'
import { CRITERIA, evaluateCriteria, healthyRunsNeeded, overallStatus, type CriterionId } from './criteria'
import { fakeRow } from './syntheticRecordings'
import type { Row } from './replay'

const many = (n: number, make: (i: number) => Row): Row[] => Array.from({ length: n }, (_, i) => make(i))
const status = (rows: Row[], id: CriterionId): string => evaluateCriteria(rows).find((r) => r.id === id)!.status
const get = (rows: Row[], id: CriterionId) => evaluateCriteria(rows).find((r) => r.id === id)!

const healthy = (n: number, alarms = 0): Row[] =>
  many(n, (i) => fakeRow({ expected: 'healthy', severity: i < alarms ? 0.95 : 0.05 }))
const deficit = (n: number, hits = n, wrongSides = 0): Row[] =>
  many(n, (i) => fakeRow({ expected: 'deficit', expectedSide: 'left', side: i < wrongSides ? 'right' : 'left', severity: i < hits ? 0.95 : 0.5 }))

describe('criteria constants', () => {
  it('match the shared spec', () => {
    expect(CRITERIA.falseAlarm).toMatchObject({ minN: 60, maxUpper: 0.05, z: 1.645 })
    expect(CRITERIA.healthyAnchor).toMatchObject({ minN: 20, minRate: 0.95, maxSeverity: 0.15 })
    expect(CRITERIA.deficitDetection).toMatchObject({ minN: 20, minRate: 0.9, minSeverity: 0.85 })
    expect(CRITERIA.sideAccuracy).toMatchObject({ minN: 10, minRate: 1 })
    expect(CRITERIA.retryRate).toMatchObject({ minN: 20, maxRate: 0.2 })
    expect(CRITERIA.borderlineNoAlert.minN).toBe(5)
  })
})

describe('falseAlarm', () => {
  it('PASS with 60 alarm-free healthy runs (upper bound 0.0432)', () => {
    const c = get(healthy(60), 'falseAlarm')
    expect(c.status).toBe('PASS')
    expect(c.interval.hi).toBeCloseTo(0.0432, 4)
    expect(c.k).toBe(0)
    expect(c.n).toBe(60)
  })

  it('INSUFFICIENT with 59 runs, and says how many more are needed', () => {
    const c = get(healthy(59), 'falseAlarm')
    expect(c.status).toBe('INSUFFICIENT DATA')
    expect(c.note).toMatch(/1 more healthy runs/)
    expect(get(healthy(20), 'falseAlarm').note).toMatch(/40 more/)
    expect(get([], 'falseAlarm').status).toBe('INSUFFICIENT DATA')
  })

  it('FAIL when one alarm sits in 60 runs (upper bound >= 5 %)', () => {
    expect(status(healthy(60, 1), 'falseAlarm')).toBe('FAIL')
  })

  it('FAIL even on a small n when the lower bound is already >= 5 %', () => {
    expect(status(healthy(10, 3), 'falseAlarm')).toBe('FAIL')
    // one alarm in 10 is not yet provable either way
    expect(status(healthy(10, 1), 'falseAlarm')).toBe('INSUFFICIENT DATA')
  })

  it('counts only non-retry healthy runs', () => {
    const rows = [...healthy(60), ...many(10, () => fakeRow({ expected: 'healthy', retry: true }))]
    expect(get(rows, 'falseAlarm').n).toBe(60)
  })

  it('healthyRunsNeeded counts ADDITIONAL runs up to the minimum n, more when an alarm exists', () => {
    expect(healthyRunsNeeded(0, 0)).toBe(60)
    expect(healthyRunsNeeded(0, 60)).toBe(0)
    expect(healthyRunsNeeded(1, 60)).toBeGreaterThan(0) // one alarm needs many more clean runs
  })
})

describe('healthyAnchor', () => {
  it('PASS at 95 % of >= 20, FAIL below, INSUFFICIENT under 20', () => {
    expect(status(healthy(20), 'healthyAnchor')).toBe('PASS')
    const nineteenOfTwenty = many(20, (i) => fakeRow({ expected: 'healthy', severity: i === 0 ? 0.4 : 0.05 }))
    expect(status(nineteenOfTwenty, 'healthyAnchor')).toBe('PASS') // 0.95 exactly
    const eighteenOfTwenty = many(20, (i) => fakeRow({ expected: 'healthy', severity: i < 2 ? 0.4 : 0.05 }))
    expect(status(eighteenOfTwenty, 'healthyAnchor')).toBe('FAIL')
    expect(status(healthy(19), 'healthyAnchor')).toBe('INSUFFICIENT DATA')
  })
})

describe('deficitDetection', () => {
  it('PASS at 90 % of >= 20, FAIL below, INSUFFICIENT under 20; interval is reported', () => {
    expect(status(deficit(20, 18), 'deficitDetection')).toBe('PASS')
    expect(status(deficit(20, 17), 'deficitDetection')).toBe('FAIL')
    expect(status(deficit(19), 'deficitDetection')).toBe('INSUFFICIENT DATA')
    const c = get(deficit(20, 18), 'deficitDetection')
    expect(c.interval.lo).toBeGreaterThan(0.6)
    expect(c.interval.hi).toBeLessThanOrEqual(1)
  })
})

describe('sideAccuracy', () => {
  it('needs 100 % correct over >= 10 sided deficit runs', () => {
    expect(status(deficit(10), 'sideAccuracy')).toBe('PASS')
    expect(status(deficit(10, 10, 1), 'sideAccuracy')).toBe('FAIL')
    expect(status(deficit(9), 'sideAccuracy')).toBe('INSUFFICIENT DATA')
  })
  it('ignores deficit runs without an expected side', () => {
    const rows = many(10, () => fakeRow({ expected: 'deficit', expectedSide: 'none', severity: 0.95 }))
    expect(get(rows, 'sideAccuracy').n).toBe(0)
  })
})

describe('retryRate', () => {
  const runs = (retries: number, total = 20): Row[] => many(total, (i) => fakeRow({ expected: 'healthy', severity: 0.05, retry: i < retries }))
  it('PASS at <= 20 %, FAIL above, INSUFFICIENT under 20 runs; counts every run', () => {
    expect(status(runs(4), 'retryRate')).toBe('PASS')
    expect(status(runs(5), 'retryRate')).toBe('FAIL')
    expect(status(runs(1, 19), 'retryRate')).toBe('INSUFFICIENT DATA')
    expect(get(runs(4), 'retryRate')).toMatchObject({ k: 4, n: 20 })
  })
})

describe('borderlineNoAlert', () => {
  const borderline = (n: number, alerts = 0): Row[] => many(n, (i) => fakeRow({ expected: 'borderline', severity: i < alerts ? 0.95 : 0.35 }))
  it('PASS when none alert (n >= 5), FAIL on any alert, INSUFFICIENT under 5', () => {
    expect(status(borderline(5), 'borderlineNoAlert')).toBe('PASS')
    expect(status(borderline(5, 1), 'borderlineNoAlert')).toBe('FAIL')
    expect(status(borderline(4), 'borderlineNoAlert')).toBe('INSUFFICIENT DATA')
  })
})

describe('overallStatus', () => {
  it('FAIL beats INSUFFICIENT beats PASS; an empty set is INSUFFICIENT, never PASS', () => {
    expect(overallStatus(evaluateCriteria([]))).toBe('INSUFFICIENT DATA')
    const passing = [...healthy(60), ...deficit(20), ...many(5, () => fakeRow({ expected: 'borderline', severity: 0.35 }))]
    expect(overallStatus(evaluateCriteria(passing))).toBe('PASS')
    expect(overallStatus(evaluateCriteria([...healthy(60, 1), ...deficit(20)]))).toBe('FAIL')
    expect(overallStatus(evaluateCriteria([...healthy(20), ...deficit(20)]))).toBe('INSUFFICIENT DATA')
  })
})
