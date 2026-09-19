import { describe, expect, it } from 'vitest'
import type { TestResult } from '../contracts'
import { buildSidecar, findSpeechScenario, SPEECH_SCENARIOS, speechBaseName } from './speechScenarios'

const liveResult: TestResult = { test: 'speech', severity: 0.1, confidence: 0.9, metrics: {}, flags: [], startedAt: 1, durationMs: 2 }

describe('speech scenarios', () => {
  it('has the six required scenarios with the right expectations', () => {
    const byId = Object.fromEntries(SPEECH_SCENARIOS.map((s) => [s.id, s.expected]))
    expect(byId).toEqual({
      'speech-normal': 'healthy',
      'speech-fast-casual': 'healthy',
      'speech-quiet-tired': 'healthy',
      'speech-mimic-slurred': 'deficit',
      'speech-mimic-slow-pauses': 'deficit',
      'speech-mimic-flat-monotone': 'deficit',
    })
    for (const s of SPEECH_SCENARIOS) expect(s.instructions.length).toBeGreaterThan(10)
    expect(findSpeechScenario('speech-normal')?.label).toBeTruthy()
    expect(findSpeechScenario('nope')).toBeUndefined()
  })

  it('names the wav and json with a shared, filesystem-safe base name', () => {
    expect(speechBaseName('Sam O’Neil', 'speech-normal', '2026-09-19T01:02:03.456Z')).toBe('sam-o-neil__speech-normal__2026-09-19T01-02-03-456Z')
    expect(speechBaseName('  ', 'x', '2026')).toBe('anon__x__2026')
  })

  it('builds the sidecar schema the Python CLI reads', () => {
    const sc = buildSidecar({
      subject: ' sam ',
      scenarioId: 'speech-mimic-slurred',
      notes: 'quiet room',
      targetPhrase: "You can't teach an old dog new tricks.",
      durationS: 3.14159,
      sampleRate: 16000,
      createdAt: '2026-09-19T01:02:03.456Z',
      liveResult,
    })
    expect(Object.keys(sc).sort()).toEqual(
      ['createdAt', 'durationS', 'expected', 'kind', 'liveResult', 'notes', 'sampleRate', 'scenario', 'schema', 'subject', 'targetPhrase'].sort(),
    )
    expect(sc).toMatchObject({ schema: 1, kind: 'speech', subject: 'sam', scenario: 'speech-mimic-slurred', expected: 'deficit', durationS: 3.142 })
  })

  it('falls back to unlabeled/healthy for an unknown scenario', () => {
    const sc = buildSidecar({ subject: '', scenarioId: 'bogus', notes: '', targetPhrase: 'x', durationS: 1, sampleRate: 16000, createdAt: 't', liveResult })
    expect(sc).toMatchObject({ subject: 'anon', scenario: 'unlabeled', expected: 'healthy' })
  })
})
