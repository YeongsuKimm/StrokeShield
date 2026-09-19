// Demo/simulation mode data + runner (docs/spec/06 "Demo mode"), used by the Shift+D DemoPanel. Extracted from the
// component so the injection path is unit-tested: results go through the NORMAL `completeTest` path, so scoring, the
// dashboard, the agent context and the alert code all run for real, and NO consent is required (a demo must work on a
// cold page with no camera, microphone or backend).
import { testSequence } from '../config'
import type { TestName, TestResult } from '../contracts'
import { useSession } from '../session/store'

export type Severities = Record<TestName, number>

export const fakeResult = (test: TestName, severity: number, flags: string[] = []): TestResult => ({
  test,
  severity,
  confidence: 0.9,
  metrics: {},
  flags,
  startedAt: Date.now(),
  durationMs: 0,
})

export const DEMO_FLAGS: Record<TestName, string> = {
  face: 'one side of the smile lifts less',
  arms: 'one arm drifted down',
  speech: 'slow, unclear speech',
  eyes: 'gaze does not track to one side',
}

export const STROKE: Severities = { face: 0.8, arms: 0.7, speech: 0.7, eyes: 0.6 }
export const HEALTHY: Severities = { face: 0.05, arms: 0.05, speech: 0.05, eyes: 0.05 }
/** Lands in the middle ("something showed up") band. */
export const CAUTION: Severities = { face: 0.3, arms: 0.3, speech: 0.3, eyes: 0.3 }

/** Reset the session and feed one result per configured test. Ends in 'clear' or 'countdown' depending on the score. */
export function runDemoScenario(v: Severities, stopRunners: () => void = () => {}): void {
  stopRunners()
  const s = useSession.getState()
  s.reset()
  s.beginTests() // a no-op without consent; harmless, the results below do not depend on it
  for (const t of testSequence()) useSession.getState().completeTest(fakeResult(t, v[t], v[t] > 0.5 ? [DEMO_FLAGS[t]] : []))
}
