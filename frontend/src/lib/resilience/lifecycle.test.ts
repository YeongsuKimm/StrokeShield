import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestName, TestResult } from '../contracts'
import { useSession } from '../session/store'
import { createSpeechRunner } from '../speech/speechRunner'
import { RecordingCancelled } from '../speech/micErrors'
import { createTestRunner } from '../vision/useTestRunner'
import type { Detectors, FrameSource, VisionSnapshot, VisionSummary } from '../vision/useMediaPipe'
import { installLifecycle, keepsScreenAwake, useLifecycle, type LifecycleDeps } from './lifecycle'
import { __resetPrefetch, installPrefetchOnConsent, prefetchVisionAssets, type PrefetchDeps } from './prefetch'
import { createWakeLock, type WakeLockApi, type WakeLockSentinelLike } from './wakeLock'

// ---- counting fakes ------------------------------------------------------------------------------------------------
class FakeTarget {
  handlers = new Map<string, Set<() => void>>()
  visibilityState = 'visible'
  addEventListener(t: string, fn: () => void) {
    if (!this.handlers.has(t)) this.handlers.set(t, new Set())
    this.handlers.get(t)!.add(fn)
  }
  removeEventListener(t: string, fn: () => void) {
    this.handlers.get(t)?.delete(fn)
  }
  emit(t: string) {
    for (const fn of [...(this.handlers.get(t) ?? [])]) fn()
  }
  get count() {
    return [...this.handlers.values()].reduce((n, s) => n + s.size, 0)
  }
}

class FakeWakeLockApi implements WakeLockApi {
  acquired = 0
  released = 0
  fail = false
  request(): Promise<WakeLockSentinelLike> {
    if (this.fail) return Promise.reject(new Error('NotAllowedError'))
    this.acquired++
    let done = false
    return Promise.resolve({
      release: () => {
        if (!done) {
          done = true
          this.released++
        }
        return Promise.resolve()
      },
    })
  }
  get open() {
    return this.acquired - this.released
  }
}

const flush = () => vi.advanceTimersByTimeAsync(0)
const s = () => useSession.getState()
const done = (test: TestName, severity = 0.05): TestResult => ({ test, severity, confidence: 0.9, metrics: {}, flags: [], startedAt: 0, durationMs: 0 })

function makeLifecycle() {
  const doc = new FakeTarget()
  const win = new FakeTarget()
  const wl = new FakeWakeLockApi()
  const hardware = { cancelRunners: vi.fn(), stopCamera: vi.fn(), releaseMic: vi.fn() }
  const resume = vi.fn<(t: TestName) => void>()
  const deps: LifecycleDeps = { doc, win, hardware, wakeLock: createWakeLock(() => wl), resume }
  return { doc, win, wl, hardware, resume, deps }
}

describe('wake lock', () => {
  it('holds while wanted, releases on drop, survives a denied request, re-acquires when the page is visible again', async () => {
    const api = new FakeWakeLockApi()
    const c = createWakeLock(() => api)
    c.hold()
    c.hold() // idempotent
    await Promise.resolve()
    expect(api.acquired).toBe(1)
    expect(c.held).toBe(true)
    c.drop()
    expect(api.open).toBe(0)
    expect(c.held).toBe(false)
    api.fail = true
    c.hold()
    await Promise.resolve()
    await Promise.resolve()
    expect(c.held).toBe(false) // denied: carried on without it
    api.fail = false
    c.onVisible()
    await Promise.resolve()
    expect(c.held).toBe(true)
    c.drop()
  })

  it('a drop that arrives while the request is still in flight releases the lock as soon as it lands', async () => {
    const api = new FakeWakeLockApi()
    const c = createWakeLock(() => api)
    c.hold()
    c.drop()
    await flushMicrotasks()
    expect(api.open).toBe(0)
  })

  it('an unsupported browser (no wakeLock) is a silent no-op', () => {
    const c = createWakeLock(() => undefined)
    expect(() => (c.hold(), c.onVisible(), c.drop())).not.toThrow()
  })
})
const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('lifecycle: tab hidden, page leaving, wake lock', () => {
  beforeEach(() => {
    s().clearAll()
    s().giveConsent()
    useLifecycle.getState().set(null)
  })

  it('screen stays awake for checks and the alert, and only then', () => {
    expect(keepsScreenAwake('idle')).toBe(false)
    expect(keepsScreenAwake('clear')).toBe(false)
    for (const p of ['face', 'arms', 'speech', 'eyes', 'countdown', 'alerting'] as const) expect(keepsScreenAwake(p)).toBe(true)
  })

  it('tab hidden mid-check: run cancelled, camera off, mic left alone; visible again: the camera check restarts', () => {
    const { doc, hardware, resume, deps } = makeLifecycle()
    const off = installLifecycle(deps)
    s().beginTests()
    const phase = s().phase as TestName
    doc.visibilityState = 'hidden'
    doc.emit('visibilitychange')
    expect(hardware.cancelRunners).toHaveBeenCalledOnce()
    expect(hardware.stopCamera).toHaveBeenCalledOnce()
    expect(hardware.releaseMic).not.toHaveBeenCalled()
    expect(useLifecycle.getState().interrupted).toBe(phase)
    doc.visibilityState = 'visible'
    doc.emit('visibilitychange')
    if (phase === 'speech') expect(resume).not.toHaveBeenCalled()
    else expect(resume).toHaveBeenCalledWith(phase)
    expect(useLifecycle.getState().resumed).toBe(phase !== 'speech')
    off()
  })

  it('speech is never auto-restarted: the notice stays until the patient records or moves on', () => {
    const { doc, resume, deps } = makeLifecycle()
    const off = installLifecycle(deps)
    s().beginTests()
    for (const t of ['eyes', 'face', 'arms']) s().skipTest(t as TestName)
    expect(s().phase).toBe('speech')
    doc.visibilityState = 'hidden'
    doc.emit('visibilitychange')
    doc.visibilityState = 'visible'
    doc.emit('visibilitychange')
    expect(resume).not.toHaveBeenCalled()
    expect(useLifecycle.getState().interrupted).toBe('speech')
    s().skipTest('speech') // moves on
    expect(useLifecycle.getState().interrupted).toBeNull()
    off()
  })

  it('a hidden tab never pauses the countdown or an alert in flight', () => {
    const { doc, hardware, deps } = makeLifecycle()
    const off = installLifecycle(deps)
    s().requestEmergency('user_request')
    doc.visibilityState = 'hidden'
    doc.emit('visibilitychange')
    expect(hardware.cancelRunners).not.toHaveBeenCalled()
    expect(useLifecycle.getState().interrupted).toBeNull()
    expect(s().phase).toBe('countdown')
    off()
  })

  it('pagehide and beforeunload stop the camera and microphone', () => {
    const { win, hardware, deps } = makeLifecycle()
    const off = installLifecycle(deps)
    win.emit('pagehide')
    expect(hardware.stopCamera).toHaveBeenCalledOnce()
    expect(hardware.releaseMic).toHaveBeenCalledOnce()
    win.emit('beforeunload')
    expect(hardware.stopCamera).toHaveBeenCalledTimes(2)
    off()
  })

  it('a stopHardware step that throws cannot stop the others', () => {
    const { win, hardware, deps } = makeLifecycle()
    hardware.stopCamera.mockImplementation(() => {
      throw new Error('busy')
    })
    const off = installLifecycle(deps)
    expect(() => win.emit('pagehide')).not.toThrow()
    expect(hardware.releaseMic).toHaveBeenCalledOnce()
    off()
  })
})

describe('warming the vision assets after consent', () => {
  const mkDeps = (over: Partial<PrefetchDeps> = {}): PrefetchDeps & { fetched: string[]; imported: number } => {
    const d = {
      fetched: [] as string[],
      imported: 0,
      fetchAsset: async (u: string) => void d.fetched.push(u),
      importRuntime: async () => void d.imported++,
      saveData: () => false,
      later: (fn: () => void) => fn(),
      ...over,
    }
    return d
  }
  beforeEach(() => {
    __resetPrefetch()
    s().clearAll()
  })

  it('starts the moment consent is given, once, fetching one file at a time', async () => {
    const deps = mkDeps()
    const off = installPrefetchOnConsent({ urls: ['/a', '/b'] }, deps)
    expect(deps.fetched).toEqual([]) // no consent yet: nothing touched
    s().giveConsent()
    await flushMicrotasks()
    expect(deps.imported).toBe(1)
    expect(deps.fetched).toEqual(['/a', '/b'])
    s().clearAll()
    s().giveConsent()
    await flushMicrotasks()
    expect(deps.fetched).toEqual(['/a', '/b']) // not again
    off()
  })

  it('respects Save-Data and swallows every failure', async () => {
    expect(await prefetchVisionAssets({ urls: ['/a'] }, mkDeps({ saveData: () => true }))).toBe('skipped')
    __resetPrefetch()
    const bad = mkDeps({ fetchAsset: () => Promise.reject(new Error('offline')), importRuntime: () => Promise.reject(new Error('chunk')) })
    await expect(prefetchVisionAssets({ urls: ['/a', '/b'] }, bad)).resolves.toBe('started')
  })
})

// ---- the leak check: 10 back-to-back sessions --------------------------------------------------------------------------
const READY: VisionSummary = { status: 'ready', error: null, delegate: 'CPU', fps: 20, faceDetected: true, poseDetected: true, brightness: 120, videoSize: { w: 1280, h: 720 } }
class CountingSource implements FrameSource {
  latest: VisionSnapshot = { seq: 0, t: 0, face: null, pose: null, brightness: 0, aspect: 16 / 9 }
  summary = READY
  acquired = 0
  released = 0
  listeners = new Set<(s: VisionSnapshot) => void>()
  acquire() {
    this.acquired++
    return () => void this.released++
  }
  subscribeFrames(fn: (s: VisionSnapshot) => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  subscribeSummary() {
    return () => {}
  }
  waitUntilReady() {
    return Promise.resolve({ ok: true as const })
  }
  setDetectors(_d: Partial<Detectors>) {}
}

describe('10 back-to-back sessions leave nothing running', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    s().clearAll()
    s().giveConsent()
    useLifecycle.getState().set(null)
  })
  afterEach(() => {
    vi.useRealTimers()
    s().clearAll()
  })

  it('no timers, listeners, camera holds, mic recordings or wake locks survive any session', async () => {
    const doc = new FakeTarget()
    const win = new FakeTarget()
    const wl = new FakeWakeLockApi()
    const src = new CountingSource()
    const vision = createTestRunner({ source: () => src, publish: () => {}, setHint: () => {}, completeTest: (r) => s().completeTest(r) })
    let recordingsOpen = 0
    let recordingsTotal = 0
    const speech = createSpeechRunner({
      record: (opts) => {
        recordingsOpen++
        recordingsTotal++
        return new Promise((_res, rej) => {
          opts.signal?.addEventListener('abort', () => {
            recordingsOpen--
            rej(new RecordingCancelled())
          })
        })
      },
      publish: () => {},
      setHint: () => {},
      completeTest: (r) => s().completeTest(r),
    })
    const baseTimers = vi.getTimerCount()

    for (let session = 1; session <= 10; session++) {
      const off = installLifecycle({
        doc,
        win,
        hardware: {
          cancelRunners: () => (vision.cancel(), speech.cancel()),
          stopCamera: () => {},
          releaseMic: () => {},
        },
        wakeLock: createWakeLock(() => wl),
        resume: () => {},
      })

      s().reset()
      s().beginTests()
      // a camera check that gets interrupted by the tab going into the background...
      const face = vision.runFace()
      await flush()
      doc.visibilityState = 'hidden'
      doc.emit('visibilitychange')
      await expect(face).resolves.toMatchObject({ flags: ['Cancelled.'] })
      doc.visibilityState = 'visible'
      doc.emit('visibilitychange')
      // ...then the rest of the session, one recording that is cancelled by moving on, and a result screen
      for (const t of ['eyes', 'face', 'arms'] as TestName[]) s().completeTest(done(t))
      const rec = speech.runSpeech()
      await flush()
      s().skipTest('speech')
      speech.cancel()
      await rec
      if (session % 3 === 0) {
        s().requestEmergency('user_request')
        s().cancelCountdown()
      }
      await flush()
      off()
      await flush()

      // ---- nothing left behind ----
      expect(doc.count, `session ${session}: document listeners`).toBe(0)
      expect(win.count, `session ${session}: window listeners`).toBe(0)
      expect(src.listeners.size, `session ${session}: frame subscriptions`).toBe(0)
      expect(src.released, `session ${session}: camera holds`).toBe(src.acquired)
      expect(recordingsOpen, `session ${session}: open recordings`).toBe(0)
      expect(wl.open, `session ${session}: wake locks`).toBe(0)
      expect(vi.getTimerCount(), `session ${session}: timers`).toBe(baseTimers)
    }
    expect(src.acquired).toBeGreaterThanOrEqual(10)
    expect(recordingsTotal).toBeGreaterThanOrEqual(10)
    expect(wl.acquired).toBeGreaterThanOrEqual(10)
  })
})
