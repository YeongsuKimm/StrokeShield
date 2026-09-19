import type { TestResult } from '../contracts'
import { useCaptureProgress, type RunnableTest } from './progressStore'

export const VISION_RETRY_DELAY_MS = 2000
/** A check that is idle with no result for this long is "stuck" (e.g. cancelled by another test) and shows a button. */
export const VISION_STUCK_GRACE_MS = 800

export type VisionActionState = 'running' | 'retry-pending' | 'try-again' | 'stuck' | 'starting' | 'done'

/**
 * What the patient can see/do on a vision check screen. INVARIANT: there is never a state with nothing to see or
 * press: either a run is going, a retry is about to start, a result is there to accept, or a button is offered
 * ('try-again' after a failed attempt; 'stuck' when the check went idle without any result, which happens when
 * another test cancels it or the screen's own auto-start never took effect). 'starting' is only the first
 * fraction of a second after the screen mounts.
 */
export function visionActionState(s: {
  running: RunnableTest | null
  retryPending: RunnableTest | null
  result: Pick<TestResult, 'needsRetry'> | undefined
  idleGraceElapsed: boolean
}): VisionActionState {
  if (s.running !== null) return 'running'
  if (s.retryPending !== null) return 'retry-pending'
  if (s.result?.needsRetry) return 'try-again'
  if (s.result) return 'done'
  return s.idleGraceElapsed ? 'stuck' : 'starting'
}

export const showsRetryButton = (state: VisionActionState): boolean => state === 'try-again' || state === 'stuck'

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Run once, leave the retry hint visible briefly, then automatically make one fresh attempt. */
export async function runVisionWithOneRetry(
  run: () => Promise<TestResult>,
  isActive: () => boolean,
  wait: (ms: number) => Promise<void> = delay,
): Promise<TestResult> {
  const first = await run()
  if (!first.needsRetry || first.flags[0] === 'Cancelled.' || !isActive()) return first
  const test = first.test as RunnableTest
  useCaptureProgress.getState().setRetryPending(test)
  try {
    await wait(VISION_RETRY_DELAY_MS)
    return isActive() ? run() : first
  } finally {
    // Do not clear a newer pending retry belonging to another check.
    if (useCaptureProgress.getState().retryPending === test) useCaptureProgress.getState().setRetryPending(null)
  }
}
