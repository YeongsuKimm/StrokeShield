import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describeError, installGlobalErrorHandlers, isChunkLoadError, recordError, scrub, useErrorLog } from './errorLog'
import { connectivityOf, installConnectivityListeners, useNetwork } from './network'

class FakeTarget {
  handlers = new Map<string, Set<(e: Event) => void>>()
  addEventListener(t: string, fn: (e: Event) => void) {
    if (!this.handlers.has(t)) this.handlers.set(t, new Set())
    this.handlers.get(t)!.add(fn)
  }
  removeEventListener(t: string, fn: (e: Event) => void) {
    this.handlers.get(t)?.delete(fn)
  }
  emit(t: string, e: object = {}) {
    for (const fn of [...(this.handlers.get(t) ?? [])]) fn(e as Event)
  }
  get count() {
    return [...this.handlers.values()].reduce((n, s) => n + s.size, 0)
  }
}

describe('error log: sanitised, bounded, never throws', () => {
  let debug: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    useErrorLog.getState().clear()
    debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
  })
  afterEach(() => debug.mockRestore())

  it('scrubs phone numbers, coordinates, emails and query strings (no PII in logs)', () => {
    const t = scrub('sms to +1 (410) 555-0199 at 39.2904,-76.6122 for a.b@c.com via /api?name=Jo&x=1')
    expect(t).not.toMatch(/555|39\.29|a\.b@c\.com|name=Jo/)
    expect(t).toContain('[digits]')
    expect(t).toContain('[email]')
  })

  it('keeps only name + short scrubbed message, never a stack', () => {
    const e = new Error('boom 4105550199')
    const d = describeError(e)
    expect(d).toEqual({ name: 'Error', message: 'boom [digits]' })
    recordError('error', e)
    expect(JSON.stringify(useErrorLog.getState().recent)).not.toContain('at ')
    expect(String(debug.mock.calls[0]?.[0])).toContain('[app] error')
  })

  it('handles non-Error rejections (undefined, strings, objects) and stays bounded', () => {
    for (const r of [undefined, null, 'x', { message: 'm' }, 42]) expect(() => recordError('unhandledrejection', r)).not.toThrow()
    for (let i = 0; i < 50; i++) recordError('error', new Error(String(i)))
    expect(useErrorLog.getState().recent.length).toBeLessThanOrEqual(8)
    expect(useErrorLog.getState().total).toBeGreaterThan(50)
  })

  it('global handlers log error and unhandledrejection, and remove themselves', () => {
    const t = new FakeTarget()
    const off = installGlobalErrorHandlers(t)
    expect(t.count).toBe(2)
    t.emit('error', { error: new Error('a') })
    t.emit('unhandledrejection', { reason: new Error('b') })
    expect(useErrorLog.getState().recent.map((e) => e.source)).toEqual(['error', 'unhandledrejection'])
    off()
    expect(t.count).toBe(0)
  })

  it('recognises a failed lazy chunk (dropped wifi / stale deploy)', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js'))).toBe(true)
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('x is undefined'))).toBe(false)
  })
})

describe('connectivity: navigator.onLine plus a failed-request heuristic', () => {
  beforeEach(() => useNetwork.setState({ online: true, failStreak: 0 }))

  it('offline wins; two connectivity failures mean unreachable; a success or coming back online clears it', () => {
    expect(connectivityOf({ online: true, failStreak: 0 })).toBe('ok')
    expect(connectivityOf({ online: true, failStreak: 1 })).toBe('ok')
    expect(connectivityOf({ online: true, failStreak: 2 })).toBe('unreachable')
    expect(connectivityOf({ online: false, failStreak: 0 })).toBe('offline')
    const { record, setOnline } = useNetwork.getState()
    record({ ok: false, kind: 'timeout' })
    record({ ok: false, kind: 'network' })
    expect(connectivityOf(useNetwork.getState())).toBe('unreachable')
    record({ ok: true })
    expect(connectivityOf(useNetwork.getState())).toBe('ok')
    record({ ok: false, kind: 'timeout' })
    record({ ok: false, kind: 'timeout' })
    setOnline(false)
    setOnline(true)
    expect(useNetwork.getState().failStreak).toBe(0)
  })

  it('a server answer (4xx/5xx) does not count as unreachable', () => {
    const { record } = useNetwork.getState()
    record({ ok: false, kind: 'timeout' })
    record({ ok: false, kind: 'server' })
    expect(useNetwork.getState().failStreak).toBe(0)
  })

  it('browser online/offline events drive the store and are removed on cleanup', () => {
    const t = new FakeTarget()
    const off = installConnectivityListeners(t)
    t.emit('offline')
    expect(useNetwork.getState().online).toBe(false)
    t.emit('online')
    expect(useNetwork.getState().online).toBe(true)
    off()
    expect(t.count).toBe(0)
  })
})
