import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FEATURES } from '../config'
import { useSession } from './store'
import type { TestName, TestResult } from '../contracts'

const result = (test: TestName, severity: number, extra: Partial<TestResult> = {}): TestResult => ({
  test,
  severity,
  confidence: 1,
  metrics: {},
  flags: [],
  startedAt: 0,
  durationMs: 0,
  ...extra,
})

const s = () => useSession.getState()

describe('session state machine', () => {
  const eyesDefault = FEATURES.eyesTest
  beforeEach(() => {
    FEATURES.eyesTest = false // most cases exercise the plain FAST order; the eyes case turns it back on
    s().reset()
  })
  afterEach(() => {
    FEATURES.eyesTest = eyesDefault
  })

  it('walks face -> arms -> speech -> clear for healthy results', () => {
    s().beginTests()
    expect(s().phase).toBe('face')
    s().completeTest(result('face', 0.05))
    expect(s().phase).toBe('arms')
    s().completeTest(result('arms', 0.05))
    expect(s().phase).toBe('speech')
    s().completeTest(result('speech', 0.05))
    expect(s().phase).toBe('clear')
  })

  it('does not score until every test has a usable result, whatever order they finish in', () => {
    s().beginTests()
    s().completeTest(result('arms', 0.9))
    expect(s().phase).toBe('face')
    s().completeTest(result('speech', 0.9))
    expect(s().phase).toBe('face')
  })

  it('goes to countdown when risk crosses the threshold', () => {
    s().beginTests()
    s().completeTest(result('face', 0.9))
    s().completeTest(result('speech', 0.8))
    s().completeTest(result('arms', 0.8))
    expect(s().phase).toBe('countdown')
    expect(s().alertReason).toBe('risk_threshold')
  })

  it('stays on the same phase for a retry result', () => {
    s().beginTests()
    s().completeTest(result('speech', 0, { needsRetry: true, confidence: 0 }))
    expect(s().phase).toBe('face')
  })

  it('starts with eyes, then face, arms and speech', () => {
    FEATURES.eyesTest = true
    s().beginTests()
    expect(s().phase).toBe('eyes')
    s().completeTest(result('eyes', 0.05))
    expect(s().phase).toBe('face')
    s().completeTest(result('face', 0.05))
    expect(s().phase).toBe('arms')
    s().completeTest(result('arms', 0.05))
    expect(s().phase).toBe('speech')
    s().completeTest(result('speech', 0.05))
    expect(s().phase).toBe('clear')
  })

  describe('skipping', () => {
    it('moves past a test the patient could not complete', () => {
      s().beginTests()
      s().skipTest('speech')
      expect(s().phase).toBe('face')
      expect(s().skipped).toEqual(['speech'])
    })

    it('does not come back to a skipped test after a later retry', () => {
      s().beginTests()
      s().skipTest('speech')
      s().completeTest(result('face', 0, { needsRetry: true, confidence: 0 }))
      expect(s().phase).toBe('face')
      s().completeTest(result('face', 0.05))
      expect(s().phase).toBe('arms')
    })

    it('still scores the tests that did run, and can trigger on them alone', () => {
      s().beginTests()
      s().skipTest('speech')
      s().completeTest(result('face', 0.95))
      s().skipTest('arms')
      expect(s().phase).toBe('countdown')
      expect(s().risk?.contributions.map((c) => c.test)).toEqual(['face'])
    })

    it('reaches a verdict when every test is skipped', () => {
      s().beginTests()
      for (const t of ['speech', 'face', 'arms'] as TestName[]) s().skipTest(t)
      expect(s().phase).toBe('clear')
      expect(s().risk?.risk).toBe(0)
    })
  })

  it('user request bypasses the score and can be cancelled', () => {
    s().beginTests()
    s().requestEmergency()
    expect(s().phase).toBe('countdown')
    expect(s().alertReason).toBe('user_request')
    s().cancelCountdown()
    expect(s().phase).toBe('cancelled')
  })

  it('reset clears results, skips and transcript', () => {
    s().beginTests()
    s().skipTest('speech')
    s().addTranscript('agent', 'hello')
    s().reset()
    expect(s().phase).toBe('idle')
    expect(s().skipped).toEqual([])
    expect(s().transcript).toEqual([])
  })
})
