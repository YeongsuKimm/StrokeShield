import { describe, expect, it } from 'vitest'
import { BORDERLINE, droopLeft, droopRight, makeCapture, NATURAL_MILD, SYMMETRIC, ASPECT } from '../vision/faceTestUtils'
import type { FaceSpec } from '../vision/faceTestUtils'
import type { Expected, ExpectedSide, Recording } from './recording'
import { analyzeRow, evaluate, formatFailures, formatTable, replay, summarize, wouldAlert } from './replay'

const faceRec = (spec: FaceSpec, expected: Expected, expectedSide: ExpectedSide = 'none', scenario = 'face-test'): Recording => {
  const { neutral, smile } = makeCapture(spec)
  return {
    schema: 1,
    id: scenario,
    createdAt: '2026-01-01T00:00:00.000Z',
    subject: 'synthetic',
    scenario,
    expected,
    expectedSide,
    notes: '',
    inputs: { kind: 'face', neutral, smile },
    liveResult: replay({ inputs: { kind: 'face', neutral, smile } } as Recording),
  }
}

describe('replay + evaluate on synthetic face recordings', () => {
  it('a symmetric smile passes as healthy and does not alert', () => {
    const row = analyzeRow(faceRec(SYMMETRIC, 'healthy'), 'a.json')
    expect(row.verdict.ok).toBe(true)
    expect(row.alert).toBe(false)
    expect(ASPECT).toBeGreaterThan(1)
  })

  it('natural mild asymmetry still passes as healthy', () => {
    expect(analyzeRow(faceRec(NATURAL_MILD, 'healthy'), 'b.json').verdict.ok).toBe(true)
  })

  it('a clear left droop labelled deficit/left passes and would alert', () => {
    const row = analyzeRow(faceRec(droopLeft(1), 'deficit', 'left'), 'c.json')
    expect(row.verdict.ok).toBe(true)
    expect(row.alert).toBe(true)
  })

  it('the same left droop labelled as right is flagged as wrong side', () => {
    const v = analyzeRow(faceRec(droopLeft(1), 'deficit', 'right'), 'd.json').verdict
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/wrong side/)
  })

  it('a healthy label on a clear droop is a false-alarm failure', () => {
    const v = analyzeRow(faceRec(droopRight(1), 'healthy'), 'e.json').verdict
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/FALSE ALARM/)
  })

  it('a deficit label on a healthy smile is a MISSED failure', () => {
    const v = analyzeRow(faceRec(SYMMETRIC, 'deficit', 'left'), 'f.json').verdict
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/MISSED/)
  })

  it('a borderline smile is accepted as borderline and does not alert', () => {
    const row = analyzeRow(faceRec(BORDERLINE, 'borderline'), 'g.json')
    expect(row.result.severity).toBeGreaterThan(0.2)
    expect(row.alert).toBe(false)
  })

  it('unusable data is reported as a retry, not a pass or a fail-by-severity', () => {
    const rec = faceRec(SYMMETRIC, 'healthy')
    if (rec.inputs.kind !== 'face') throw new Error('kind')
    rec.inputs = { kind: 'face', neutral: [], smile: [] }
    const v = analyzeRow(rec, 'h.json').verdict
    expect(v.retry).toBe(true)
    expect(v.ok).toBe(false)
  })

  it('evaluate ignores expected side for healthy runs', () => {
    const r = replay(faceRec(SYMMETRIC, 'healthy'))
    expect(evaluate({ expected: 'healthy', expectedSide: 'none' }, r).ok).toBe(true)
    expect(wouldAlert(r)).toBe(false)
  })
})

describe('summarize / formatTable', () => {
  const rows = [
    analyzeRow(faceRec(SYMMETRIC, 'healthy', 'none', 'face-healthy'), 'a'),
    analyzeRow(faceRec(NATURAL_MILD, 'healthy', 'none', 'face-healthy'), 'b'),
    analyzeRow(faceRec(droopLeft(1), 'deficit', 'left', 'face-mimic-left-droop'), 'c'),
    analyzeRow(faceRec(droopRight(1), 'deficit', 'left', 'face-mimic-left-droop'), 'd'), // mislabelled on purpose
  ]

  it('groups by scenario and counts passes, alerts and side accuracy', () => {
    const s = summarize(rows)
    const healthy = s.find((x) => x.scenario === 'face-healthy')!
    const deficit = s.find((x) => x.scenario === 'face-mimic-left-droop')!
    expect(healthy.n).toBe(2)
    expect(healthy.pass).toBe(2)
    expect(healthy.alerts).toBe(0)
    expect(deficit.n).toBe(2)
    expect(deficit.pass).toBe(1)
    expect(deficit.sideCorrect).toBe(1)
    expect(deficit.sideChecked).toBe(2)
  })

  it('prints a table with the headline numbers and lists failures', () => {
    const table = formatTable(rows)
    expect(table).toMatch(/scenario/)
    expect(table).toMatch(/False alarms on healthy runs: 0\/2/)
    expect(table).toMatch(/Clear deficits detected .*: 2\/2/)
    const failures = formatFailures(rows)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatch(/wrong side/)
  })

  it('handles an empty set', () => {
    expect(() => formatTable([])).not.toThrow()
    expect(summarize([])).toEqual([])
  })
})
