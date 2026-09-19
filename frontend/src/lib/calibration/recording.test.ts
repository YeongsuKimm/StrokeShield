import { describe, expect, it } from 'vitest'
import { findScenario, parseRecording, recordingFileName, roundDeep, scenariosFor, serializeRecording, validateRecording, type Recording } from './recording'

const base = (): Recording => ({
  schema: 1,
  id: 'r1',
  createdAt: '2026-09-18T22:30:15.123Z',
  subject: 'Sam Q.',
  scenario: 'arms-healthy',
  expected: 'healthy',
  expectedSide: 'none',
  notes: '',
  inputs: { kind: 'arms', frames: [{ landmarks: [{ x: 0.123456789, y: 0.5, z: -0.000012, visibility: 0.9999999 }], t: 1234.56789 }], aspectRatio: 16 / 9 },
  liveResult: { test: 'arms', severity: 0, confidence: 1, metrics: {}, flags: [], startedAt: 1, durationMs: 1 },
})

describe('recording', () => {
  it('round-trips through JSON', () => {
    const rec = base()
    const back = parseRecording(serializeRecording(rec))
    expect(back.subject).toBe(rec.subject)
    expect(back.inputs.kind).toBe('arms')
  })

  it('rounds numbers to 4 decimals to keep files small', () => {
    expect(roundDeep({ a: [0.123456789, -0.000012, 5] })).toEqual({ a: [0.1235, 0, 5] })
    const back = parseRecording(serializeRecording(base()))
    if (back.inputs.kind !== 'arms') throw new Error('kind')
    expect(back.inputs.frames[0].landmarks[0].x).toBe(0.1235)
  })

  it('keeps non-finite numbers untouched instead of crashing', () => {
    expect(() => roundDeep({ x: NaN, y: Infinity })).not.toThrow()
  })

  it('makes safe, unique-ish file names', () => {
    expect(recordingFileName(base())).toBe('sam-q__arms-healthy__2026-09-18T22-30-15-123Z.json')
    expect(recordingFileName({ subject: '  ../etc  ', scenario: 'x', createdAt: '2026-01-01T00:00:00.000Z' })).not.toMatch(/[/\\ ]/)
    expect(recordingFileName({ subject: '', scenario: 'x', createdAt: 'T' })).toMatch(/^anon__/)
  })

  it('rejects things that are not recordings, with a readable reason', () => {
    expect(() => validateRecording(null, 'a.json')).toThrow(/a\.json: not an object/)
    expect(() => validateRecording({ schema: 2 })).toThrow(/unsupported schema/)
    expect(() => validateRecording({ schema: 1, inputs: { kind: 'nope' } })).toThrow(/inputs\.kind/)
    expect(() => validateRecording({ ...base(), expected: 'great' })).toThrow(/expected/)
    expect(() => validateRecording({ ...base(), inputs: { kind: 'face', neutral: [] } })).toThrow(/face inputs/)
  })

  it('has labelled scenarios whose side is consistent with expectation', () => {
    expect(scenariosFor('face').length).toBeGreaterThanOrEqual(3)
    expect(scenariosFor('arms').length).toBeGreaterThanOrEqual(4)
    expect(scenariosFor('eyes').length).toBeGreaterThanOrEqual(3)
    for (const s of [...scenariosFor('face'), ...scenariosFor('arms'), ...scenariosFor('eyes')]) {
      expect(s.expected === 'deficit' ? s.side !== 'none' : s.side === 'none').toBe(true)
      expect(s.instructions.length).toBeGreaterThan(10)
    }
    expect(findScenario('face-healthy')?.kind).toBe('face')
    expect(findScenario('eyes-mimic-cannot-look-left')).toMatchObject({ kind: 'eyes', expected: 'deficit', side: 'left' })
    expect(findScenario('nope')).toBeUndefined()
  })
})
