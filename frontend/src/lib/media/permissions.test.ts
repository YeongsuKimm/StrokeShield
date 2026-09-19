// Permission flows with a mocked browser (no real camera, mic or GPS): every rejection path resolves, nothing hangs,
// and the alert never waits on, or prompts for, location.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  classifyGrantError,
  guideStartProblemText,
  locationForAlert,
  problemText,
  requestCamera,
  requestLocation,
  requestMicrophone,
  sanitizeFix,
  watchTracksEnded,
} from './permissions'

interface FakeTrack {
  stopped: boolean
  stop: () => void
  listeners: Record<string, (() => void)[]>
  addEventListener: (t: string, f: () => void) => void
  removeEventListener: (t: string, f: () => void) => void
  fire: (t: string) => void
}
const track = (): FakeTrack => {
  const t: FakeTrack = {
    stopped: false,
    stop: () => void (t.stopped = true),
    listeners: {},
    addEventListener: (type, f) => void (t.listeners[type] ??= []).push(f),
    removeEventListener: (type, f) => void (t.listeners[type] = (t.listeners[type] ?? []).filter((x) => x !== f)),
    fire: (type) => (t.listeners[type] ?? []).forEach((f) => f()),
  }
  return t
}
const fakeStream = (...tracks: FakeTrack[]) => ({ getTracks: () => tracks }) as unknown as MediaStream
const domErr = (name: string) => Object.assign(new Error(name), { name })

type GeoOk = { coords: { latitude: number; longitude: number; accuracy: number } }
interface Nav {
  mediaDevices?: { getUserMedia: ReturnType<typeof vi.fn> }
  geolocation?: { getCurrentPosition: ReturnType<typeof vi.fn> }
  permissions?: { query: ReturnType<typeof vi.fn> }
}
const setNav = (nav: Nav) => vi.stubGlobal('navigator', nav)
const perm = (state: string) => ({ query: vi.fn(async () => ({ state, addEventListener() {}, removeEventListener() {} })) })
type GeoOpts = { timeout: number; maximumAge: number; enableHighAccuracy: boolean }
const geoOk = (lat: number, lng: number, accuracy = 12.6) =>
  vi.fn((ok: (p: GeoOk) => void, _err?: unknown, _o?: GeoOpts) => ok({ coords: { latitude: lat, longitude: lng, accuracy } }))
const geoErr = (code: number) =>
  vi.fn((_ok: unknown, err: (e: { code: number; message: string }) => void, _o?: GeoOpts) => err({ code, message: 'x' }))

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('classifyGrantError', () => {
  it('maps the getUserMedia error names', () => {
    expect(classifyGrantError(domErr('NotAllowedError'))).toBe('denied')
    expect(classifyGrantError(domErr('NotFoundError'))).toBe('no-device')
    expect(classifyGrantError(domErr('OverconstrainedError'))).toBe('no-device')
    expect(classifyGrantError(domErr('NotReadableError'))).toBe('busy')
    expect(classifyGrantError(new TypeError('x'))).toBe('unsupported')
    expect(classifyGrantError(null)).toBe('unknown')
  })
})

describe('requestCamera / requestMicrophone', () => {
  it('grants, and the camera probe stream is stopped at once', async () => {
    const t = track()
    setNav({ mediaDevices: { getUserMedia: vi.fn(async () => fakeStream(t)) } })
    expect(await requestCamera()).toEqual({ state: 'granted', problem: null })
    expect(t.stopped).toBe(true)
  })

  it('the microphone stream is handed back (kept open) with raw-signal constraints', async () => {
    const t = track()
    const gum = vi.fn(async () => fakeStream(t))
    setNav({ mediaDevices: { getUserMedia: gum } })
    const r = await requestMicrophone()
    expect(r.state).toBe('granted')
    expect(r.stream).not.toBeNull()
    expect(t.stopped).toBe(false)
    expect(gum).toHaveBeenCalledWith({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  })

  it('an explicit block is "denied" with the lock-icon advice', async () => {
    setNav({ mediaDevices: { getUserMedia: vi.fn(async () => Promise.reject(domErr('NotAllowedError'))) }, permissions: perm('denied') })
    const r = await requestCamera()
    expect(r).toEqual({ state: 'denied', problem: 'denied' })
    expect(problemText('camera', 'denied')).toMatch(/lock icon/i)
    expect(problemText('microphone', 'denied')).toMatch(/Microphone/)
  })

  it('a prompt closed with the X (state still "prompt") is "dismissed", not "blocked"', async () => {
    setNav({ mediaDevices: { getUserMedia: vi.fn(async () => Promise.reject(domErr('NotAllowedError'))) }, permissions: perm('prompt') })
    expect(await requestCamera()).toEqual({ state: 'prompt', problem: 'dismissed' })
  })

  it('a browser without the Permissions API treats NotAllowedError as denied (retry stays available)', async () => {
    setNav({ mediaDevices: { getUserMedia: vi.fn(async () => Promise.reject(domErr('NotAllowedError'))) } })
    expect(await requestMicrophone()).toMatchObject({ state: 'denied', problem: 'denied', stream: null })
  })

  it('a missing or busy device is retryable, not "blocked"', async () => {
    setNav({ mediaDevices: { getUserMedia: vi.fn(async () => Promise.reject(domErr('NotFoundError'))) } })
    expect((await requestCamera()).problem).toBe('no-device')
    expect((await requestCamera()).state).not.toBe('denied')
    setNav({ mediaDevices: { getUserMedia: vi.fn(async () => Promise.reject(domErr('NotReadableError'))) } })
    const busy = await requestMicrophone()
    expect(busy.problem).toBe('busy')
    expect(busy.state).not.toBe('denied')
    setNav({ mediaDevices: { getUserMedia: vi.fn(async () => Promise.reject(domErr('OverconstrainedError'))) } })
    expect((await requestCamera()).problem).toBe('no-device')
  })

  it('insecure context and missing mediaDevices resolve with a clear problem instead of throwing', async () => {
    setNav({})
    expect((await requestCamera()).problem).toBe('unsupported')
    vi.stubGlobal('isSecureContext', false)
    const gum = vi.fn()
    setNav({ mediaDevices: { getUserMedia: gum } })
    expect((await requestMicrophone()).problem).toBe('insecure')
    expect(gum).not.toHaveBeenCalled()
    expect(problemText('camera', 'insecure')).toMatch(/HTTPS or localhost/)
  })

  it('a prompt nobody answers gives up after the wait cap, and a late grant does not leak the device', async () => {
    vi.useFakeTimers()
    const t = track()
    let release: (s: MediaStream) => void = () => {}
    setNav({ mediaDevices: { getUserMedia: vi.fn(() => new Promise<MediaStream>((r) => (release = r))) } })
    const p = requestMicrophone(1000)
    await vi.advanceTimersByTimeAsync(1001)
    expect(await p).toMatchObject({ state: 'prompt', problem: 'dismissed', stream: null })
    release(fakeStream(t))
    await vi.advanceTimersByTimeAsync(0)
    expect(t.stopped).toBe(true)
  })
})

describe('watchTracksEnded', () => {
  it('fires once when a track ends (revoked / unplugged) and can be detached', () => {
    const a = track()
    const b = track()
    const cb = vi.fn()
    watchTracksEnded(fakeStream(a, b), cb)
    a.fire('ended')
    b.fire('ended')
    expect(cb).toHaveBeenCalledTimes(1)
    const c = track()
    const cb2 = vi.fn()
    watchTracksEnded(fakeStream(c), cb2)()
    c.fire('ended')
    expect(cb2).not.toHaveBeenCalled()
  })
})

describe('sanitizeFix', () => {
  it('rounds to ~1 m and whole-metre accuracy', () => {
    expect(sanitizeFix({ lat: 39.328912345, lng: -76.621987654, accuracyM: 12.6 })).toEqual({ lat: 39.32891, lng: -76.62199, accuracyM: 13 })
  })
  it('drops non-finite or out-of-range fixes (the backend would 422 the whole alert)', () => {
    expect(sanitizeFix({ lat: NaN, lng: 0 })).toBeNull()
    expect(sanitizeFix({ lat: 91, lng: 0 })).toBeNull()
    expect(sanitizeFix({ lat: 0, lng: -181 })).toBeNull()
    expect(sanitizeFix({ lat: 0, lng: Infinity })).toBeNull()
    expect(sanitizeFix(undefined)).toBeNull()
  })
  it('drops a bad accuracy but keeps the position; accepts the boundaries', () => {
    expect(sanitizeFix({ lat: 90, lng: -180, accuracyM: NaN })).toEqual({ lat: 90, lng: -180 })
    expect(sanitizeFix({ lat: 1, lng: 1, accuracyM: -5 })).toEqual({ lat: 1, lng: 1 })
  })
})

describe('requestLocation', () => {
  it('returns a rounded fix and asks with a bounded timeout and a small maximumAge', async () => {
    const g = geoOk(39.328912345, -76.621987654)
    setNav({ geolocation: { getCurrentPosition: g } })
    const r = await requestLocation()
    expect(r).toEqual({ state: 'granted', problem: null, fix: { lat: 39.32891, lng: -76.62199, accuracyM: 13 } })
    const opts = g.mock.calls[0][2] as GeoOpts
    expect(opts.timeout).toBeLessThanOrEqual(10_000)
    expect(opts.maximumAge).toBeLessThanOrEqual(60_000)
  })

  it('PERMISSION_DENIED -> denied with the optional/skip wording, no retry call', async () => {
    const g = geoErr(1)
    setNav({ geolocation: { getCurrentPosition: g } })
    expect(await requestLocation()).toEqual({ state: 'denied', problem: 'denied', fix: null })
    expect(g).toHaveBeenCalledTimes(1)
    expect(problemText('location', 'denied')).toMatch(/optional/i)
  })

  it('POSITION_UNAVAILABLE and TIMEOUT retry once coarsely, then report an allowed-but-no-fix state (not "Blocked")', async () => {
    for (const code of [2, 3]) {
      const g = geoErr(code)
      setNav({ geolocation: { getCurrentPosition: g }, permissions: perm('granted') })
      const r = await requestLocation()
      expect(g).toHaveBeenCalledTimes(2)
      expect((g.mock.calls[1][2] as GeoOpts).enableHighAccuracy).toBe(false)
      expect(r.state).toBe('granted')
      expect(r.problem).toBe(code === 2 ? 'unavailable' : 'timeout')
      expect(r.fix).toBeNull()
    }
  })

  it('the coarse retry can succeed', async () => {
    let n = 0
    const g = vi.fn((ok: (p: GeoOk) => void, err: (e: { code: number; message: string }) => void) => {
      if (++n === 1) err({ code: 3, message: 't' })
      else ok({ coords: { latitude: 10, longitude: 20, accuracy: 900 } })
    })
    setNav({ geolocation: { getCurrentPosition: g } })
    expect((await requestLocation()).fix).toEqual({ lat: 10, lng: 20, accuracyM: 900 })
  })

  it('a prompt nobody answers cannot hang: it resolves as dismissed after the hard cap', async () => {
    vi.useFakeTimers()
    setNav({ geolocation: { getCurrentPosition: vi.fn() } })
    const p = requestLocation(10_000, 5_000)
    await vi.advanceTimersByTimeAsync(5_001)
    expect(await p).toEqual({ state: 'prompt', problem: 'dismissed', fix: null })
  })

  it('unsupported, insecure and a synchronous throw all resolve', async () => {
    setNav({})
    expect((await requestLocation()).problem).toBe('unsupported')
    setNav({ geolocation: { getCurrentPosition: vi.fn(() => { throw new Error('boom') }) } })
    expect((await requestLocation()).fix).toBeNull()
    vi.stubGlobal('isSecureContext', false)
    const g = vi.fn()
    setNav({ geolocation: { getCurrentPosition: g } })
    expect((await requestLocation()).problem).toBe('insecure')
    expect(g).not.toHaveBeenCalled()
  })

  it('never logs coordinates', async () => {
    const dbg = vi.spyOn(console, 'debug').mockImplementation(() => {})
    setNav({ geolocation: { getCurrentPosition: geoOk(39.328912345, -76.621987654) } })
    await requestLocation()
    setNav({ geolocation: { getCurrentPosition: geoErr(2) } })
    await requestLocation()
    expect(JSON.stringify(dbg.mock.calls)).not.toMatch(/39\.3|76\.6/)
  })
})

describe('locationForAlert (emergency path)', () => {
  const cached = { lat: 39.32891, lng: -76.62199, accuracyM: 30 }

  it('never prompts: with state "prompt" it uses the cached fix and does not call the geolocation API', async () => {
    const g = vi.fn()
    setNav({ geolocation: { getCurrentPosition: g }, permissions: perm('prompt') })
    expect(await locationForAlert(cached)).toEqual(cached)
    expect(g).not.toHaveBeenCalled()
  })

  it('a location revoked since consent is dropped', async () => {
    setNav({ geolocation: { getCurrentPosition: vi.fn() }, permissions: perm('denied') })
    expect(await locationForAlert(cached)).toBeUndefined()
  })

  it('granted: refreshes with a short timeout and a small maximumAge; failure falls back to the cached fix', async () => {
    const g = geoOk(40.1, -75.2, 8)
    setNav({ geolocation: { getCurrentPosition: g }, permissions: perm('granted') })
    expect(await locationForAlert(cached)).toEqual({ lat: 40.1, lng: -75.2, accuracyM: 8 })
    const o = g.mock.calls[0][2] as GeoOpts
    expect(o.timeout).toBeLessThanOrEqual(3000)
    expect(o.maximumAge).toBeLessThanOrEqual(120_000)
    setNav({ geolocation: { getCurrentPosition: geoErr(3) }, permissions: perm('granted') })
    expect(await locationForAlert(cached)).toEqual(cached)
  })

  it('granted but the location is never delivered: the alert is delayed by at most the cap', async () => {
    vi.useFakeTimers()
    setNav({ geolocation: { getCurrentPosition: vi.fn() }, permissions: perm('granted') })
    const p = locationForAlert(cached, 3000)
    await vi.advanceTimersByTimeAsync(3300)
    expect(await p).toEqual(cached)
  })

  it('no cache, no permission, no API: resolves undefined (the SMS says location unavailable)', async () => {
    setNav({})
    expect(await locationForAlert(undefined)).toBeUndefined()
    expect(await locationForAlert({ lat: NaN, lng: 1 })).toBeUndefined()
  })
})

describe('guideStartProblemText', () => {
  it('is actionable for a blocked microphone and never empty for anything else', () => {
    expect(guideStartProblemText(domErr('NotAllowedError'))).toMatch(/lock icon/i)
    expect(guideStartProblemText(domErr('NotFoundError'))).toMatch(/No microphone/)
    expect(guideStartProblemText(new Error('HTTP 500'))).toMatch(/could not start/)
    expect(guideStartProblemText(undefined)).toMatch(/without the guide/)
  })
})
