import type { TestResult } from '../contracts'
import { useCaptureProgress, type RunnableTest } from './progressStore'

export const VISION_RETRY_DELAY_MS = 2000

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
