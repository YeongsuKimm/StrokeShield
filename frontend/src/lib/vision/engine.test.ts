// Engine (camera + MediaPipe) lifecycle with a mocked browser: GPU -> CPU fallback, model/WASM failure, hanging load,
// camera unplugged, restart races, several people in view, and resource accounting across many runs.
// NOT a real camera or real MediaPipe: only the bookkeeping (created vs closed, streams stopped, rAF/timers) is verified.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mp = vi.hoisted(() => ({
  createdLandmarkers: 0,
  closedLandmarkers: 0,
  failDelegates: new Set<string>(),
  failFileset: false,
  hangLoad: false,
  hangs: [] as (() => void)[],
  faceResults: [] as unknown[],
  detectThrows: 0,
}))

vi.mock('@mediapipe/tasks-vision', () => {
  const make = (kind: 'face' | 'pose') => ({
    createFromOptions: async (_fs: unknown, o: { baseOptions: { delegate: string } }) => {
      if (mp.hangLoad) await new Promise<void>((r) => mp.hangs.push(r))
      if (mp.failDelegates.has(o.baseOptions.delegate)) throw new Error(`${kind} ${o.baseOptions.delegate} init failed`)
      mp.createdLandmarkers++
      return {
        closed: false,
        close() {
          if (this.closed) return
          this.closed = true
          mp.closedLandmarkers++
        },
        detectForVideo() {
          if (mp.detectThrows > 0) {
            mp.detectThrows--
            throw new Error('detect failed')
          }
          return kind === 'face'
            ? (mp.faceResults.shift() ?? { faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] })
            : { landmarks: [] }
        },
      }
    },
    FACE_LANDMARKS_CONTOURS: [],
    POSE_CONNECTIONS: [],
  })
  return {
    FilesetResolver: {
      forVisionTasks: async () => {
        if (mp.failFileset) throw new Error('wasm 404')
        return {}
      },
    },
    FaceLandmarker: make('face'),
    PoseLandmarker: make('pose'),
  }
})

import { MODEL_LOAD_FAILED_TEXT, VisionEngine } from './useMediaPipe'

// ---- fake browser ---------------------------------------------------------------------------------------------------
interface FakeTrack {
  stopped: boolean
  handlers: Set<() => void>
  stop(): void
  addEventListener(e: string, h: () => void): void
  removeEventListener(e: string, h: () => void): void
}
const world = {
  streams: [] as { tracks: FakeTrack[] }[],
  gumFails: undefined as undefined | string,
  rafQueue: new Map<number, () => void>(),
  rafId: 0,
  video: undefined as unknown as { currentTime: number; srcObject: unknown },
}

const makeTrack = (): FakeTrack => {
  const t: FakeTrack = {
    stopped: false,
    handlers: new Set(),
    stop() {
      t.stopped = true
    },
    addEventListener: (_e, h) => t.handlers.add(h),
    removeEventListener: (_e, h) => t.handlers.delete(h),
  }
  return t
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  mp.hangs.length = 0
  Object.assign(mp, { createdLandmarkers: 0, closedLandmarkers: 0, failFileset: false, hangLoad: false, faceResults: [], detectThrows: 0 })
  mp.failDelegates.clear()
  world.streams = []
  world.gumFails = undefined
  world.rafQueue.clear()
  world.rafId = 0
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    world.rafQueue.set(++world.rafId, cb)
    return world.rafId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => void world.rafQueue.delete(id))
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => {
        if (world.gumFails) throw Object.assign(new Error(world.gumFails), { name: world.gumFails })
        const tracks = [makeTrack()]
        const stream = { tracks, getTracks: () => tracks }
        world.streams.push(stream)
        return stream
      },
    },
  })
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: () => {},
            getImageData: () => ({ data: new Uint8ClampedArray(32 * 18 * 4).fill(120) }),
          }),
        }
      }
      const v = { muted: false, playsInline: false, autoplay: false, srcObject: null as unknown, readyState: 4, videoWidth: 1280, videoHeight: 720, currentTime: 0, style: {}, play: async () => {} }
      world.video = v
      return v
    },
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
async function until(engine: VisionEngine, status: string) {
  for (let i = 0; i < 50 && engine.summary.status !== status; i++) {
    await vi.advanceTimersByTimeAsync(10)
    await flush()
  }
  expect(engine.summary.status).toBe(status)
}
/** One camera frame: advance the clock, the video's currentTime, and run the queued rAF callbacks once. */
async function frame(dtMs = 50) {
  await vi.advanceTimersByTimeAsync(dtMs)
  world.video.currentTime += dtMs / 1000
  const cbs = [...world.rafQueue.values()]
  world.rafQueue.clear()
  cbs.forEach((cb) => cb())
}
const tracksStopped = () => world.streams.every((s) => s.tracks.every((t) => t.stopped))

describe('engine: delegates and load failures', () => {
  it('falls back from a GPU init failure to CPU and runs', async () => {
    mp.failDelegates.add('GPU')
    const e = new VisionEngine()
    void e.start()
    await until(e, 'ready')
    expect(e.summary.delegate).toBe('CPU')
    e.stop()
  })

  it('a model that fails on every delegate is a clean, actionable error with nothing left open', async () => {
    mp.failDelegates.add('GPU').add('CPU')
    const e = new VisionEngine()
    void e.start()
    await until(e, 'error')
    expect(e.summary.error?.kind).toBe('model-load-failed')
    expect(e.summary.error?.message).toBe(MODEL_LOAD_FAILED_TEXT)
    expect(tracksStopped()).toBe(true) // camera released, not left lit
    expect(mp.closedLandmarkers).toBe(mp.createdLandmarkers)
    expect(await e.waitUntilReady(1000)).toEqual({ ok: false, reason: MODEL_LOAD_FAILED_TEXT })
    // restart works once the problem is gone
    mp.failDelegates.clear()
    e.restart()
    await until(e, 'ready')
    e.stop()
  })

  it('WASM that does not load is the same clean error', async () => {
    mp.failFileset = true
    const e = new VisionEngine()
    void e.start()
    await until(e, 'error')
    expect(e.summary.error?.kind).toBe('model-load-failed')
    expect(tracksStopped()).toBe(true)
  })

  it('a load that never settles times out into an error, and its late result is closed, not installed', async () => {
    mp.hangLoad = true
    const e = new VisionEngine()
    void e.start()
    await vi.advanceTimersByTimeAsync(46_000)
    await flush()
    expect(e.summary.status).toBe('error')
    expect(e.summary.error?.kind).toBe('model-load-failed')
    mp.hangLoad = false
    mp.hangs.splice(0).forEach((r) => r()) // the stalled fetch finally completes
    await flush()
    await flush()
    expect(mp.closedLandmarkers).toBe(mp.createdLandmarkers)
    expect(e.summary.status).toBe('error')
  })

  it('camera errors are typed and stop nothing that was not opened', async () => {
    world.gumFails = 'NotAllowedError'
    const e = new VisionEngine()
    void e.start()
    await until(e, 'error')
    expect(e.summary.error?.kind).toBe('permission-denied')
    world.gumFails = 'NotFoundError'
    e.restart()
    await until(e, 'error')
    expect(e.summary.error?.kind).toBe('no-camera')
  })

  it('GPU delegate that initialises but never runs is rebuilt on CPU', async () => {
    const e = new VisionEngine()
    void e.start()
    await until(e, 'ready')
    expect(e.summary.delegate).toBe('GPU')
    mp.detectThrows = 3
    for (let i = 0; i < 6; i++) await frame()
    await flush()
    expect(e.summary.delegate).toBe('CPU')
    expect(e.summary.status).toBe('ready')
    e.stop()
    expect(mp.closedLandmarkers).toBe(mp.createdLandmarkers)
  })

  it('a detector that keeps failing ends in an error and stops the rAF loop', async () => {
    const e = new VisionEngine()
    mp.failDelegates.add('GPU')
    void e.start()
    await until(e, 'ready')
    mp.detectThrows = 100
    for (let i = 0; i < 20; i++) await frame()
    expect(e.summary.status).toBe('error')
    expect(e.summary.error?.kind).toBe('inference-failed')
    expect(world.rafQueue.size).toBe(0)
    e.stop()
  })
})

describe('engine: camera unplugged and restarts', () => {
  it('a track that ends mid-run becomes an error with the loop stopped; restart recovers', async () => {
    const e = new VisionEngine()
    void e.start()
    await until(e, 'ready')
    await frame()
    world.streams[0].tracks[0].handlers.forEach((h) => h())
    expect(e.summary.status).toBe('error')
    expect(world.rafQueue.size).toBe(0)
    e.restart()
    await until(e, 'ready')
    expect(world.streams).toHaveLength(2)
    e.stop()
    expect(tracksStopped()).toBe(true)
  })

  it('restart() while the first start is still loading never closes the newer run', async () => {
    mp.hangLoad = true
    const e = new VisionEngine()
    void e.start()
    await vi.advanceTimersByTimeAsync(100)
    await flush()
    e.restart() // stale start #1 is still awaiting its model load
    await vi.advanceTimersByTimeAsync(100)
    mp.hangLoad = false
    mp.hangs.splice(0).forEach((r) => r()) // the stale load finishes (the newer one is released next)
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(10)
      await flush()
    }
    await until(e, 'ready')
    // The live run's camera is still open and exactly one face+pose pair is installed and open.
    expect(world.streams[world.streams.length - 1].tracks[0].stopped).toBe(false)
    expect(mp.createdLandmarkers - mp.closedLandmarkers).toBe(2)
    e.stop()
    expect(tracksStopped()).toBe(true)
    expect(mp.closedLandmarkers).toBe(mp.createdLandmarkers)
  })

  it('no growth across 20 consecutive start/stop cycles (landmarkers, streams, rAF loops, timers)', async () => {
    const e = new VisionEngine()
    for (let i = 0; i < 20; i++) {
      const release = e.acquire()
      await until(e, 'ready')
      for (let f = 0; f < 5; f++) await frame()
      expect(world.rafQueue.size).toBe(1) // exactly one loop
      release()
      await vi.advanceTimersByTimeAsync(600) // STOP_DELAY_MS
      await flush()
      expect(e.summary.status).toBe('idle')
      expect(world.rafQueue.size).toBe(0)
    }
    expect(world.streams).toHaveLength(20)
    expect(tracksStopped()).toBe(true)
    expect(mp.createdLandmarkers).toBe(40)
    expect(mp.closedLandmarkers).toBe(40)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('engine: two people in view', () => {
  // A face mesh of `w` (fraction of frame width) centred at (cx, cy); landmark 1000-independent, 478 points.
  const mesh = (cx: number, cy: number, w: number) =>
    Array.from({ length: 478 }, (_, i) => ({ x: cx - w / 2 + w * ((i % 20) / 19), y: cy - w * 0.6 + w * 1.2 * (Math.floor(i / 20) / 24), z: 0 }))

  it('tracks ONE person even when the model swaps their order every frame; blendshapes stay with the same face', async () => {
    const e = new VisionEngine()
    void e.start()
    await until(e, 'ready')
    e.setDetectors({ face: true, pose: false })
    const patient = mesh(0.5, 0.45, 0.3)
    const judge = mesh(0.85, 0.4, 0.14)
    const bs = (v: number) => ({ categories: [{ categoryName: 'mouthSmileLeft', score: v }] })
    const seen: number[] = []
    for (let i = 0; i < 40; i++) {
      const flip = i % 2 === 1
      mp.faceResults.push({
        faceLandmarks: flip ? [judge, patient] : [patient, judge],
        faceBlendshapes: flip ? [bs(0.9), bs(0.1)] : [bs(0.1), bs(0.9)], // patient always 0.1, judge always 0.9
        facialTransformationMatrixes: [],
      })
      await frame()
      const f = e.latest.face
      if (f) seen.push(f.blendshapes.mouthSmileLeft)
      if (f) expect(f.landmarks[0].x).toBeLessThan(0.7) // never the judge's landmarks
      expect(e.latest.subject?.bystanders).toBe(1)
      expect(e.latest.subject?.epoch).toBe(0)
    }
    expect(seen.length).toBeGreaterThan(30)
    expect(new Set(seen)).toEqual(new Set([0.1]))
    e.stop()
  })

  it('when the patient leaves and only the judge remains, no frame is produced until the memory window passes', async () => {
    const e = new VisionEngine()
    void e.start()
    await until(e, 'ready')
    e.setDetectors({ face: true, pose: false })
    const patient = mesh(0.4, 0.45, 0.3)
    const judge = mesh(0.85, 0.4, 0.3)
    mp.faceResults.push({ faceLandmarks: [patient], faceBlendshapes: [], facialTransformationMatrixes: [] })
    await frame()
    expect(e.latest.face).not.toBeNull()
    for (let i = 0; i < 20; i++) {
      mp.faceResults.push({ faceLandmarks: [judge], faceBlendshapes: [], facialTransformationMatrixes: [] })
      await frame()
      expect(e.latest.face).toBeNull() // 1 s of only-the-judge: never measured
    }
    e.stop()
  })
})
