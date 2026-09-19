import { describe, expect, it } from 'vitest'
import { fakeRow } from './syntheticRecordings'
import { formatRampSuggestions, formatSweep, rampInsufficiency, rampSuggestions, strengthOf, sweep, SWEEP_CUTOFFS } from './tune'

const metricRows = (values: number[], expected: 'healthy' | 'deficit', metric = 'lift_asym', split: 'tune' | 'validate' = 'tune', kind: 'face' | 'arms' = 'face') =>
  values.map((v) => fakeRow({ expected, expectedSide: expected === 'deficit' ? 'left' : 'none', severity: expected === 'deficit' ? 0.9 : 0.05, metrics: { [metric]: v }, split, kind }))

describe('rampSuggestions', () => {
  const healthy = [0.02, 0.05, 0.08, 0.1, 0.12, 0.06, 0.09, 0.04, 0.11, 0.07]
  const deficit = [0.5, 0.6, 0.7, 0.55, 0.65, 0.8]

  it('points the right way on separable data: higher is worse, p90 healthy .. median deficit', () => {
    const [s] = rampSuggestions([...metricRows(healthy, 'healthy'), ...metricRows(deficit, 'deficit')])
    expect(s.direction).toBe('higher is worse')
    expect(s.normalEdge).toBeCloseTo(0.111, 3) // p90 of healthy
    expect(s.abnormalEdge).toBeCloseTo(0.625, 3) // median of deficit
    expect(s.auc).toBe(1)
    expect(s.strength).toBe('strong')
    expect(s.separated).toBe(true)
    expect(s.cohensD).toBeGreaterThan(3)
    expect(s.current).toEqual({ lo: 0.15, hi: 0.5 }) // known ramp for face lift_asym
    expect(formatRampSuggestions([s])).toMatch(/higher is worse.*suggest lo=0\.111.*hi=0\.625.*current lo=0\.15 hi=0\.5/)
  })

  it('points the other way when the deficit values are LOWER, using healthy p10', () => {
    const [s] = rampSuggestions([...metricRows(deficit, 'healthy', 'smile_strength'), ...metricRows(healthy, 'deficit', 'smile_strength')])
    expect(s.direction).toBe('lower is worse')
    expect(s.normalEdge).toBeCloseTo(0.5 + 0.05 * 0.5, 2) // p10 of the "healthy" (higher) group
    expect(s.abnormalEdge).toBeCloseTo(0.08, 2) // median of the lower group
    expect(s.auc).toBe(0)
    expect(s.strength).toBe('strong')
    expect(s.separated).toBe(true)
    expect(s.current).toBeUndefined() // unknown metric: no current ramp printed
    expect(formatRampSuggestions([s])).not.toMatch(/current/)
  })

  it('says "no useful separation" when the groups overlap', () => {
    const same = [0.1, 0.2, 0.3, 0.4, 0.5, 0.15, 0.25, 0.35, 0.45, 0.55]
    const [s] = rampSuggestions([...metricRows(same, 'healthy'), ...metricRows(same.map((v) => v + 0.01), 'deficit')])
    expect(s.separated).toBe(false)
    expect(s.strength).toBe('weak')
    expect(formatRampSuggestions([s])).toMatch(/no useful separation/)
  })

  it('uses the TUNE split only and ignores retries', () => {
    const rows = [
      ...metricRows(healthy, 'healthy'),
      ...metricRows(deficit, 'deficit'),
      ...metricRows([9, 9, 9, 9], 'healthy', 'lift_asym', 'validate'),
      ...metricRows([9, 9, 9], 'deficit', 'lift_asym', 'validate'),
      fakeRow({ expected: 'healthy', retry: true, metrics: { lift_asym: 99 }, split: 'tune' }),
    ]
    const [s] = rampSuggestions(rows)
    expect(s.nHealthy).toBe(healthy.length)
    expect(s.nDeficit).toBe(deficit.length)
    expect(s.normalEdge).toBeLessThan(0.2)
  })

  it('skips metrics that lack healthy or deficit values, flags small groups, keeps kinds apart', () => {
    expect(rampSuggestions(metricRows(healthy, 'healthy'))).toEqual([])
    const rows = [...metricRows([0.1, 0.2], 'healthy', 'drift_asym', 'tune', 'arms'), ...metricRows([30, 40], 'deficit', 'drift_asym', 'tune', 'arms')]
    const [s] = rampSuggestions(rows)
    expect(s.kind).toBe('arms')
    expect(s.lowN).toBe(true)
    expect(s.current).toEqual({ lo: 8, hi: 25 })
    expect(formatRampSuggestions([])).toMatch(/need healthy AND deficit/)
  })

  it('needs at least 2 healthy AND 2 deficit non-retry runs, otherwise prints "insufficient data"', () => {
    const rows = [...metricRows([0.1, 0.2, 0.3], 'healthy'), ...metricRows([0.9], 'deficit')]
    expect(rampSuggestions(rows)).toEqual([])
    const insufficient = rampInsufficiency(rows)
    expect(insufficient).toEqual([{ kind: 'face', nHealthy: 3, nDeficit: 1 }])
    expect(formatRampSuggestions([], insufficient)).toMatch(/face\s+insufficient data: need >= 2 healthy AND >= 2 deficit .*have 3 healthy, 1 deficit/)
    // exactly 2 + 2 is enough
    expect(rampSuggestions([...metricRows([0.1, 0.2], 'healthy'), ...metricRows([0.8, 0.9], 'deficit')])).toHaveLength(1)
    expect(rampInsufficiency([...metricRows([0.1, 0.2], 'healthy'), ...metricRows([0.8, 0.9], 'deficit')])).toEqual([])
    // validation-split rows never count
    expect(rampInsufficiency(metricRows([0.1, 0.2], 'healthy', 'lift_asym', 'validate'))).toEqual([])
  })

  it('labels AUC strength with the shared cut points', () => {
    expect(strengthOf(0.95)).toBe('strong')
    expect(strengthOf(0.05)).toBe('strong')
    expect(strengthOf(0.8)).toBe('moderate')
    expect(strengthOf(0.2)).toBe('moderate')
    expect(strengthOf(0.6)).toBe('weak')
  })
})

describe('sweep', () => {
  it('runs cutoffs 0.10 .. 0.95 in 0.05 steps', () => {
    expect(SWEEP_CUTOFFS[0]).toBe(0.1)
    expect(SWEEP_CUTOFFS.at(-1)).toBe(0.95)
    expect(SWEEP_CUTOFFS).toHaveLength(18)
  })

  it('counts healthy (false-positive) and deficit (detection) fractions >= cutoff, excluding retries', () => {
    const rows = [
      fakeRow({ expected: 'healthy', severity: 0.05 }),
      fakeRow({ expected: 'healthy', severity: 0.2 }),
      fakeRow({ expected: 'healthy', severity: 0.6 }),
      fakeRow({ expected: 'healthy', retry: true }),
      fakeRow({ expected: 'deficit', expectedSide: 'left', severity: 0.9 }),
      fakeRow({ expected: 'deficit', expectedSide: 'left', severity: 0.3 }),
    ]
    const s = sweep(rows)
    const at = (c: number) => s.find((r) => Math.abs(r.cutoff - c) < 1e-9)!
    expect(at(0.1)).toMatchObject({ healthyN: 3, healthyHits: 2, deficitN: 2, deficitHits: 2 })
    expect(at(0.2)).toMatchObject({ healthyHits: 2, deficitHits: 2 })
    expect(at(0.35)).toMatchObject({ healthyHits: 1, deficitHits: 1 })
    expect(at(0.95)).toMatchObject({ healthyHits: 0, deficitHits: 0 })
  })

  it('formats tune and validate side by side', () => {
    const t = [fakeRow({ expected: 'healthy', severity: 0.05 })]
    const v = [fakeRow({ expected: 'deficit', expectedSide: 'left', severity: 0.9 })]
    const table = formatSweep(t, v)
    expect(table).toMatch(/tune false-pos \| tune detected \| validate false-pos \| validate detected/)
    expect(table.split('\n')).toHaveLength(2 + 18)
    expect(formatSweep(t)).not.toMatch(/validate/)
  })
})
