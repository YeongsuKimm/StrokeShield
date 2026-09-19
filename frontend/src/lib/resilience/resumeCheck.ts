import type { TestName } from '../contracts'
import { isVisionScreenActive, runVisionWithOneRetry } from '../vision/retry'
import { testRunner } from '../vision/useTestRunner'

/** Restart a camera check that was cut short (tab hidden). Speech is never auto-restarted: recording needs a deliberate press. */
export function resumeCheck(test: TestName): void {
  if (test === 'speech') return
  const run = test === 'face' ? testRunner.runFace : test === 'arms' ? testRunner.runArms : testRunner.runEyes
  void runVisionWithOneRetry(run, () => isVisionScreenActive(test))
}
