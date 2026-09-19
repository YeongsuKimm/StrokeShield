import { beforeEach, describe, expect, it } from 'vitest'
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
  beforeEach(() => s().reset())

  it('walks face -> speech -> arms (one step back, at the end) -> clear for healthy results', () => {
    s().beginTests()
    expect(s().phase).toBe('face')
    s().completeTest(result('face', 0.05))
    expect(s().phase).toBe('speech')
    s().completeTest(result('speech', 0.05))
    expect(s().phase).toBe('arms')
    s().completeTest(result('arms', 0.05))
    expect(s().phase).toBe('clear')
  })

  it('does not score until every test has a usable result, whatever order they finish in', () => {
    s().beginTests()
    s().completeTest(result('arms', 0.9))
    expect(s().phase).toBe('face')
    s().completeTest(result('face', 0.9))
    expect(s().phase).toBe('speech')
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
    s().completeTest(result('face', 0, { needsRetry: true, confidence: 0 }))
    expect(s().phase).toBe('face')
  })

  it('inserts the eyes test after face (still close to the screen) when the feature is on', () => {
    FEATURES.eyesTest = true
    try {
      s().beginTests()
      s().completeTest(result('face', 0.05))
      expect(s().phase).toBe('eyes')
      s().completeTest(result('eyes', 0.05))
      expect(s().phase).toBe('speech')
      s().completeTest(result('speech', 0.05))
      expect(s().phase).toBe('arms')
      s().completeTest(result('arms', 0.05))
      expect(s().phase).toBe('clear')
    } finally {
      FEATURES.eyesTest = false
    }
  })

  it('user request bypasses the score and can be cancelled', () => {
    s().beginTests()
    s().requestEmergency()
    expect(s().phase).toBe('countdown')
    expect(s().alertReason).toBe('user_request')
    s().cancelCountdown()
    expect(s().phase).toBe('cancelled')
  })
})
