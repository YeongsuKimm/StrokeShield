import { describe, expect, it, vi } from 'vitest'
import type { TestResult } from '../contracts'
import { useCaptureProgress } from './progressStore'
import { useSession } from '../session/store'
import { isVisionScreenActive, runVisionWithOneRetry, VISION_RETRY_DELAY_MS } from './retry'

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

describe('isVisionScreenActive (the info page must stop a check just like a phase change does)', () => {
  it('is true only on the home route while the phase is that check', () => {
    useSession.setState({ phase: 'face', route: 'home' })
    expect(isVisionScreenActive('face')).toBe(true)
    expect(isVisionScreenActive('arms')).toBe(false)
    useSession.setState({ phase: 'face', route: 'info' }) // menu -> info page mid-test: the screen unmounts, phase unchanged
    expect(isVisionScreenActive('face')).toBe(false)
    useSession.setState({ phase: 'idle', route: 'home' })
  })

  it('a pending automatic retry does not start a hidden capture while the info page is open', async () => {
    useSession.setState({ phase: 'face', route: 'home' })
    const run = vi.fn<() => Promise<TestResult>>().mockResolvedValue(result(true, 'move closer'))
    const wait = vi.fn<(ms: number) => Promise<void>>().mockImplementation(async () => {
      useSession.setState({ route: 'info' }) // patient opens the info page during the 2 s pause
    })
    await runVisionWithOneRetry(run, () => isVisionScreenActive('face'), wait)
    expect(run).toHaveBeenCalledTimes(1)
    useSession.setState({ phase: 'idle', route: 'home' })
  })
})
