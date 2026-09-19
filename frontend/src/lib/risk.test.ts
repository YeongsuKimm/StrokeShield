import { describe, expect, it } from 'vitest'
import { computeRisk } from './risk'
import type { TestName, TestResult } from './contracts'

const result = (test: TestName, severity: number, confidence = 1, needsRetry = false): TestResult => ({
  test,
  severity,
  confidence,
  metrics: {},
  flags: [],
  startedAt: 0,
  durationMs: 0,
  needsRetry,
})

describe('computeRisk', () => {
  it('is zero with no results and does not trigger', () => {
    const r = computeRisk({})
    expect(r.risk).toBe(0)
    expect(r.triggered).toBe(false)
  })

  it('triggers on one strong signal', () => {
    expect(computeRisk({ face: result('face', 0.9) }).triggered).toBe(true)
  })

  it('does not trigger on one weak signal', () => {
    expect(computeRisk({ face: result('face', 0.4) }).triggered).toBe(false)
  })

  it('triggers on several moderate signals', () => {
    const r = computeRisk({ face: result('face', 0.6), arms: result('arms', 0.6), speech: result('speech', 0.6) })
    expect(r.triggered).toBe(true)
  })

  it('excludes retry and low-confidence results', () => {
    const r = computeRisk({ face: result('face', 1, 1, true), arms: result('arms', 1, 0.1) })
    expect(r.contributions).toHaveLength(0)
    expect(r.triggered).toBe(false)
  })

  it('is monotonic in severity', () => {
    const lo = computeRisk({ arms: result('arms', 0.3) }).risk
    const hi = computeRisk({ arms: result('arms', 0.8) }).risk
    expect(hi).toBeGreaterThan(lo)
  })

  it('adds a vision contribution only when asymmetric', () => {
    const base = { kind: 'face', side: 'left', confidence: 0.8, rationale: '' } as const
    expect(computeRisk({}, [{ ...base, finding: 'symmetric' }]).contributions).toHaveLength(0)
    expect(computeRisk({}, [{ ...base, finding: 'asymmetric' }]).contributions).toHaveLength(1)
  })
})
