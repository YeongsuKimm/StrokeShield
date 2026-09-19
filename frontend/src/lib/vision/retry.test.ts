import { describe, expect, it, vi } from 'vitest'
import type { TestResult } from '../contracts'
import { useCaptureProgress } from './progressStore'
import { runVisionWithOneRetry, VISION_RETRY_DELAY_MS } from './retry'

const result = (needsRetry = false, flag = ''): TestResult => ({
  test: 'face',
  severity: 0,
  confidence: needsRetry ? 0 : 1,
  metrics: {},
  flags: flag ? [flag] : [],
  startedAt: 1,
  durationMs: 1,
  needsRetry,
})

describe('runVisionWithOneRetry', () => {
  it('automatically retries once after leaving the reason visible', async () => {
    const run = vi.fn<() => Promise<TestResult>>().mockResolvedValueOnce(result(true, 'relax your face')).mockResolvedValueOnce(result())
    let release!: () => void
    const wait = vi.fn<(ms: number) => Promise<void>>().mockImplementation(() => new Promise<void>((resolve) => (release = resolve)))
    const pending = runVisionWithOneRetry(run, () => true, wait)
    await vi.waitFor(() => expect(useCaptureProgress.getState().retryPending).toBe('face'))
    expect(run).toHaveBeenCalledTimes(1)
    release()
    expect((await pending).needsRetry).toBeFalsy()
    expect(run).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledWith(VISION_RETRY_DELAY_MS)
    expect(useCaptureProgress.getState().retryPending).toBeNull()
  })

  it('does not retry success, cancellation, or after leaving the screen', async () => {
    for (const [first, active] of [[result(), true], [result(true, 'Cancelled.'), true], [result(true, 'move closer'), false]] as const) {
      const run = vi.fn<() => Promise<TestResult>>().mockResolvedValue(first)
      await runVisionWithOneRetry(run, () => active, vi.fn().mockResolvedValue(undefined))
      expect(run).toHaveBeenCalledTimes(1)
    }
  })

  it('stops after the second failed attempt', async () => {
    const run = vi.fn<() => Promise<TestResult>>().mockResolvedValue(result(true, 'move closer'))
    const final = await runVisionWithOneRetry(run, () => true, vi.fn().mockResolvedValue(undefined))
    expect(final.needsRetry).toBe(true)
    expect(run).toHaveBeenCalledTimes(2)
    expect(useCaptureProgress.getState().retryPending).toBeNull()
  })
})
