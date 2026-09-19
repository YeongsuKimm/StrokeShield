import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlertRequest } from './contracts'
import { API_TIMEOUTS_MS, api } from './api'
import { isApiError } from './resilience/apiErrors'
import { useNetwork } from './resilience/network'

const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response
/** A fetch that never answers but honours abort, like a dead backend behind bad wifi. */
const hang = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  })

const alertReq: AlertRequest = { reason: 'user_request', patient: {}, symptoms: [] }

async function kindOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'resolved'
  } catch (e) {
    return isApiError(e) ? e.kind : `other:${String(e)}`
  }
}

describe('api: every call has a timeout, a friendly failure and no double alert', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useNetwork.setState({ online: true, failStreak: 0 })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('a dead backend times out (health) instead of hanging, with a plain message', async () => {
    vi.stubGlobal('fetch', vi.fn(hang))
    const p = api.health().catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(API_TIMEOUTS_MS.health + 1)
    const e = await p
    expect(isApiError(e) && e.kind).toBe('timeout')
    expect((e as Error).message).toMatch(/took too long/i)
    expect((e as Error).message).not.toMatch(/abort|signal|undefined/i)
  })

  it('the alert is NEVER retried (a lost response must not become a second text) and times out cleanly', async () => {
    const f = vi.fn(hang)
    vi.stubGlobal('fetch', f)
    const p = kindOf(api.sendAlert(alertReq))
    await vi.advanceTimersByTimeAsync(API_TIMEOUTS_MS.alert + 5_000)
    expect(await p).toBe('timeout')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('an alert answered with HTTP 500 is one request and a "server" error', async () => {
    const f = vi.fn(async () => res(500, { detail: 'boom' }))
    vi.stubGlobal('fetch', f)
    expect(await kindOf(api.sendAlert(alertReq))).toBe('server')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('signed-url retries once on a server error, then succeeds', async () => {
    const f = vi.fn().mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200, { signedUrl: 'wss://x' }))
    vi.stubGlobal('fetch', f)
    const p = api.signedUrl()
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(p).resolves.toEqual({ signedUrl: 'wss://x' })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('rate limiting and client errors are not retried; a short backend message is shown, a long one is not', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(429)))
    expect(await kindOf(api.signedUrl())).toBe('rate-limited')
    vi.stubGlobal('fetch', vi.fn(async () => res(400, { error: 'Audio too short' })))
    const e = await api.analyzeSpeech(new Blob(['x']), 'hi').catch((x: unknown) => x)
    expect((e as Error).message).toContain('Audio too short')
    vi.stubGlobal('fetch', vi.fn(async () => res(400, { detail: 'x'.repeat(500) })))
    const e2 = await api.analyzeSpeech(new Blob(['x']), 'hi').catch((x: unknown) => x)
    expect((e2 as Error).message.length).toBeLessThan(150)
  })

  it('a thrown fetch (DNS, refused, CORS) is a "network" error; offline is reported as offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    expect(await kindOf(api.health())).toBe('network')
    vi.stubGlobal('navigator', { onLine: false })
    expect(await kindOf(api.health())).toBe('offline')
  })

  it('a 200 with a non-JSON body is "malformed", not a crash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError('bad')) }) as unknown as Response))
    expect(await kindOf(api.health())).toBe('malformed')
  })

  it('two connectivity failures in a row flip the "cannot reach the server" heuristic; one success clears it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await kindOf(api.health())
    expect(useNetwork.getState().failStreak).toBe(1)
    await kindOf(api.health())
    expect(useNetwork.getState().failStreak).toBe(2)
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { ok: true, dryRun: true, demoMode: false })))
    await api.health()
    expect(useNetwork.getState().failStreak).toBe(0)
  })

  it('a 4xx answer does not count as "server unreachable"', async () => {
    useNetwork.setState({ failStreak: 1 })
    vi.stubGlobal('fetch', vi.fn(async () => res(400, { error: 'nope' })))
    await kindOf(api.health())
    expect(useNetwork.getState().failStreak).toBe(0)
  })
})
