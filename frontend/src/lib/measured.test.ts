import { describe, expect, it } from 'vitest'
import type { TestName, TestResult } from './contracts'
import { MEASURED_COPY } from './copy/features'
import { measuredChecks } from './measured'

const make = (test: TestName, metrics: Record<string, number>, extra: Partial<TestResult> = {}): TestResult => ({
  test,
  severity: 0.4,
  confidence: 0.9,
  metrics,
  flags: [],
  startedAt: 0,
  durationMs: 1000,
  ...extra,
})
const ORDER: TestName[] = ['eyes', 'face', 'arms', 'speech']
const byTest = (checks: ReturnType<typeof measuredChecks>, t: TestName) => checks.find((c) => c.test === t)!

describe('measuredChecks', () => {
  it('face: mouth-corner lift on each side and the difference, in plain words', () => {
    const c = byTest(measuredChecks({ face: make('face', { lift_left: 0.082, lift_right: 0.021, lift_asym: 0.744 }) }, [], ORDER), 'face')
    expect(c.status).toBe('measured')
    expect(c.rows).toEqual([
      { label: 'Mouth corner lift, left', value: '8.2% of eye distance' },
      { label: 'Mouth corner lift, right', value: '2.1% of eye distance' },
      { label: 'Difference between sides', value: '74%' },
    ])
  })

  it('arms: each arm lowest angle and drift, plus the wrist height gap', () => {
    const c = byTest(
      measuredChecks({ arms: make('arms', { min_theta_left: 4.2, drift_left: 9.6, min_theta_right: -12.4, drift_right: -1.2, height_diff: 0.083 }) }, [], ORDER),
      'arms',
    )
    expect(c.rows).toEqual([
      { label: 'Left arm', value: 'lowest 4 degrees above level, drift 10 degrees down' },
      { label: 'Right arm', value: 'lowest 12 degrees below level, drift 1 degree up' },
      { label: 'Wrist height gap', value: '8% of shoulder width' },
    ])
  })

  it('arms: a level, steady arm reads "level" and "no drift", never a signed zero', () => {
    const c = byTest(measuredChecks({ arms: make('arms', { min_theta_left: 0.2, drift_left: -0.3 }) }, [], ORDER), 'arms')
    expect(c.rows[0].value).toBe('lowest level, drift no drift')
  })

  it('eyes: gaze range to each side; a side that could not be measured says not measured', () => {
    const both = byTest(measuredChecks({ eyes: make('eyes', { exc_left: 0.212, exc_right: 0.187, excursion_asym: 0.118 }) }, [], ORDER), 'eyes')
    expect(both.rows).toEqual([
      { label: 'Gaze range, looking left', value: '0.21 eye widths' },
      { label: 'Gaze range, looking right', value: '0.19 eye widths' },
      { label: 'Difference between sides', value: '12%' },
    ])
    const one = byTest(measuredChecks({ eyes: make('eyes', { exc_left: 0.2, exc_right: NaN, excursion_asym: NaN }) }, [], ORDER), 'eyes')
    expect(one.rows).toEqual([
      { label: 'Gaze range, looking left', value: '0.20 eye widths' },
      { label: 'Gaze range, looking right', value: MEASURED_COPY.notMeasured },
    ])
  })

  it('speech: rate, pauses and recording clarity', () => {
    const c = byTest(measuredChecks({ speech: make('speech', { articulation_rate: 4.63, n_pauses: 3, longest_pause_s: 0.61, snr_db: 24.4 }) }, [], ORDER), 'speech')
    expect(c.rows).toEqual([
      { label: 'Speaking rate', value: '4.6 syllables per second' },
      { label: 'Pauses', value: '3 pauses, longest 0.6 seconds' },
      { label: 'Recording clarity', value: '24 dB above background noise' },
    ])
  })

  it('speech: falls back to words per second and handles zero or one pause', () => {
    const zero = byTest(measuredChecks({ speech: make('speech', { speech_rate_wps: 2.14, n_pauses: 0, longest_pause_s: 0 }) }, [], ORDER), 'speech')
    expect(zero.rows.map((r) => r.value)).toEqual(['2.1 words per second', 'no pauses'])
    const one = byTest(measuredChecks({ speech: make('speech', { n_pauses: 1, longest_pause_s: 0.5 }) }, [], ORDER), 'speech')
    expect(one.rows[0].value).toBe('1 pause, 0.5 seconds')
  })

  it('skipped, unclear and missing checks say not measured, with a reason and no numbers', () => {
    const checks = measuredChecks(
      { face: make('face', { lift_left: 0.1, lift_right: 0.1 }, { needsRetry: true }), arms: make('arms', { drift_left: 5 }) },
      ['speech'],
      ORDER,
    )
    expect(byTest(checks, 'speech')).toMatchObject({ status: 'not_measured', reason: MEASURED_COPY.reasonSkipped, rows: [] })
    expect(byTest(checks, 'face')).toMatchObject({ status: 'not_measured', reason: MEASURED_COPY.reasonUnclear, rows: [] })
    expect(byTest(checks, 'eyes')).toMatchObject({ status: 'not_measured', reason: MEASURED_COPY.reasonNotRun, rows: [] })
    expect(byTest(checks, 'arms').status).toBe('measured')
  })

  it('a check whose metrics are all missing or not finite is not measured, and nothing throws', () => {
    const checks = measuredChecks({ face: make('face', { lift_left: NaN }), speech: make('speech', {}) }, [], ORDER)
    expect(byTest(checks, 'face').status).toBe('not_measured')
    expect(byTest(checks, 'speech').status).toBe('not_measured')
  })

  it('keeps the requested order and never contains a verdict word', () => {
    const checks = measuredChecks({ face: make('face', { lift_left: 0.1, lift_right: 0.09, lift_asym: 0.1 }) }, [], ORDER)
    expect(checks.map((c) => c.test)).toEqual(ORDER)
    const all = JSON.stringify(checks).toLowerCase()
    for (const banned of ['abnormal', 'normal', 'stroke', 'droop', 'severity', 'risk']) expect(all).not.toContain(banned)
  })
})
