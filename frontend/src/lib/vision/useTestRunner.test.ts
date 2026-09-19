import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestResult } from '../contracts'
import type { FaceCaptureFrame } from './face'
import type { Landmark, PoseFrame } from './landmarks'
import { createTestRunner } from './useTestRunner'
import type { Detectors, FrameSource, VisionSnapshot, VisionSummary } from './useMediaPipe'

const READY: VisionSummary = {
  status: 'ready',
  error: null,
  delegate: 'CPU',
  fps: 20,
  faceDetected: true,
  poseDetected: true,
  brightness: 120,
  videoSize: { w: 1280, h: 720 },
}

class FakeSource implements FrameSource {
  latest: VisionSnapshot = { seq: 0, t: 0, face: null, pose: null, brightness: 0, aspect: 16 / 9 }
  summary = READY
  ready: { ok: true } | { ok: false; reason: string } = { ok: true }
  acquired = 0
  released = 0
  detectorCalls: Partial<Detectors>[] = []
  restarts = 0
  restart() {
    this.restarts++
    this.summary = READY
    this.ready = { ok: true }
  }
  private listeners = new Set<(s: VisionSnapshot) => void>()
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
    return Promise.resolve(this.ready)
  }
  setDetectors(d: Partial<Detectors>) {
    this.detectorCalls.push(d)
  }
  push(t: number, part: Partial<Pick<VisionSnapshot, 'face' | 'pose'>>) {
    this.latest = { seq: this.latest.seq + 1, t, face: null, pose: null, brightness: 130, aspect: 16 / 9, ...part }
    for (const fn of [...this.listeners]) fn(this.latest)
  }
}

// A face that satisfies checkFaceFraming (width 0.3, centered).
const goodFace = (t: number, yawDeg = 0) => ({
  landmarks: Array.from({ length: 478 }, (_, i): Landmark => ({ x: 0.35 + 0.3 * (i / 477), y: 0.3 + 0.4 * ((i * 7) % 478) / 477, z: 0 })),
  blendshapes: { mouthSmileLeft: 0.5 },
  yawDeg,
  t,
})
// A pose that satisfies checkArmFraming.
const goodPose = (t: number): PoseFrame => {
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }))
  lm[11] = { x: 0.6, y: 0.4, z: 0, visibility: 1 }
  lm[12] = { x: 0.4, y: 0.4, z: 0, visibility: 1 }
  lm[13] = { x: 0.75, y: 0.4, z: 0, visibility: 1 }
  lm[14] = { x: 0.25, y: 0.4, z: 0, visibility: 1 }
  lm[15] = { x: 0.9, y: 0.4, z: 0, visibility: 1 }
  lm[16] = { x: 0.1, y: 0.4, z: 0, visibility: 1 }
  return { landmarks: lm, t }
}

const okResult = (test: 'face' | 'arms'): TestResult => ({
  test,
  severity: 0.2,
  confidence: 0.9,
  metrics: {},
  flags: [],
  startedAt: 1,
  durationMs: 1,
})

describe('createTestRunner', () => {
  let src: FakeSource
  let clock: number
  const completeTest = vi.fn<(r: TestResult) => void>()
  const setHint = vi.fn<(h?: string) => void>()
  const analyzeFace = vi.fn<(n: FaceCaptureFrame[], s: FaceCaptureFrame[]) => TestResult>(() => okResult('face'))
  const analyzeArms = vi.fn<(f: PoseFrame[], a: number) => TestResult>(() => okResult('arms'))
  const make = () =>
    createTestRunner({
      source: () => src,
      completeTest,
      setHint,
      publish: () => {},
      analyzeFace,
      analyzeArms,
      now: () => clock,
    })
  const flush = () => vi.advanceTimersByTimeAsync(0)
  /** Push one frame every 50 ms of fake time until `done` or `ms` elapse. */
  const pump = (ms: number, frameAt: (t: number) => Partial<Pick<VisionSnapshot, 'face' | 'pose'>>, done: () => boolean) => {
    for (let t = clock; t <= clock + ms && !done(); t += 50) src.push(t, frameAt(t))
    clock += ms
  }

  beforeEach(() => {
    vi.useFakeTimers()
    src = new FakeSource()
    clock = 1000
    completeTest.mockClear()
    setHint.mockClear()
    analyzeFace.mockClear()
    analyzeArms.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('runFace: captures neutral + smile frames (with brightness/aspect), stores the result, releases the camera', async () => {
    const runner = make()
    let settled = false
    const p = runner.runFace().then((r) => ((settled = true), r))
    await flush()
    expect(runner.running).toBe('face')
    expect(src.detectorCalls[0]).toEqual({ face: true, pose: false })
    pump(20_000, (t) => ({ face: goodFace(t) }), () => settled)
    await flush()
    const r = await p
    expect(r).toEqual(okResult('face'))
    expect(completeTest).toHaveBeenCalledWith(r)
    const [neutral, smile] = analyzeFace.mock.calls[0]
    expect(neutral.length).toBeGreaterThan(20)
    expect(smile.length).toBeGreaterThan(50)
    expect(neutral[0].brightness).toBe(130)
    expect(neutral[0].aspect).toBeCloseTo(16 / 9)
    expect(src.detectorCalls.at(-1)).toEqual({ face: true, pose: true })
    expect(src.released).toBe(src.acquired)
    expect(runner.running).toBeNull()
    expect(setHint).toHaveBeenLastCalledWith(undefined)
  })

  it('runFace: a head turned past the yaw limit never starts the capture (retry after the wait timeout)', async () => {
    const runner = make()
    const p = runner.runFace()
    await flush()
    let settled = false
    void p.then(() => (settled = true))
    pump(30_000, (t) => ({ face: goodFace(t, 30) }), () => settled)
    await flush()
    const r = await p
    expect(r.needsRetry).toBe(true)
    expect(r.flags[0]).toMatch(/couldn't see your face/i)
    expect(analyzeFace).not.toHaveBeenCalled()
    expect(setHint).toHaveBeenCalledWith('Look straight at the screen.')
  })

  it('runArms: 10 s hold window goes to analyzeArms with the real aspect ratio', async () => {
    const runner = make()
    let settled = false
    const p = runner.runArms().then((r) => ((settled = true), r))
    await flush()
    expect(src.detectorCalls[0]).toEqual({ face: false, pose: true })
    src.latest = { ...src.latest, aspect: 4 / 3 }
    pump(30_000, (t) => ({ pose: goodPose(t) }), () => settled)
    await flush()
    const r = await p
    expect(r.test).toBe('arms')
    const [frames, aspect] = analyzeArms.mock.calls[0]
    expect(frames.length).toBeGreaterThanOrEqual(190)
    expect(frames.length).toBeLessThanOrEqual(201)
    expect(aspect).toBeCloseTo(16 / 9) // push() stamps 16:9 on every snapshot
    expect(completeTest).toHaveBeenCalledOnce()
  })

  it('runArms: framing never OK -> stored retry result, hint carries the spoken reason', async () => {
    const runner = make()
    let settled = false
    const p = runner.runArms().then((r) => ((settled = true), r))
    await flush()
    pump(30_000, () => ({ pose: null }), () => settled)
    await flush()
    const r = await p
    expect(r.needsRetry).toBe(true)
    expect(r.flags[0]).toMatch(/both hands/i)
    expect(analyzeArms).not.toHaveBeenCalled()
    expect(completeTest).toHaveBeenCalledWith(r)
    expect(setHint).toHaveBeenLastCalledWith(r.flags[0])
  })

  it('heartbeat: still times out when the camera stops delivering frames', async () => {
    const runner = make()
    const p = runner.runArms()
    await flush()
    src.push(clock, { pose: null })
    for (let i = 0; i < 120; i++) {
      clock += 250
      await vi.advanceTimersByTimeAsync(250)
    }
    const r = await p
    expect(r.needsRetry).toBe(true)
    expect(r.flags[0]).toMatch(/both hands/i)
  })

  it('cancel: resolves with a "Cancelled." retry result, is not stored, releases the camera', async () => {
    const runner = make()
    const p = runner.runFace()
    await flush()
    pump(2000, (t) => ({ face: goodFace(t) }), () => false)
    runner.cancel()
    const r = await p
    expect(r.needsRetry).toBe(true)
    expect(r.flags[0]).toBe('Cancelled.')
    expect(completeTest).not.toHaveBeenCalled()
    expect(analyzeFace).not.toHaveBeenCalled()
    expect(src.released).toBe(src.acquired)
    expect(runner.running).toBeNull()
    expect(setHint).toHaveBeenLastCalledWith(undefined)
  })

  it('camera/model failure -> retry result with the reason, never rejects', async () => {
    src.ready = { ok: false, reason: 'Camera permission was denied.' }
    const runner = make()
    const r = await runner.runFace()
    expect(r.needsRetry).toBe(true)
    expect(r.flags[0]).toContain('Camera permission was denied.')
    expect(src.released).toBe(src.acquired)
  })

  it('the same run requested twice shares one capture; a different run cancels the first', async () => {
    const runner = make()
    const a = runner.runFace()
    const b = runner.runFace()
    expect(a).toBe(b)
    await flush()
    const c = runner.runArms()
    const ra = await a
    expect(ra.flags[0]).toBe('Cancelled.')
    await flush()
    expect(runner.running).toBe('arms')
    runner.cancel()
    expect((await c).flags[0]).toBe('Cancelled.')
  })

  it('cancel() followed at once by the same run starts a fresh capture, not the cancelled one', async () => {
    const runner = make()
    const first = runner.runFace()
    await flush()
    runner.cancel()
    const second = runner.runFace() // e.g. a retry press or agent tool right after the screen cancelled
    expect(second).not.toBe(first)
    expect((await first).flags[0]).toBe('Cancelled.')
    await flush()
    pump(8000, (t) => ({ face: goodFace(t) }), () => false)
    const r = await second
    expect(r.flags[0]).not.toBe('Cancelled.')
    expect(completeTest).toHaveBeenCalledTimes(1)
    expect(runner.running).toBeNull()
  })

  it('a camera stuck in the error state is restarted by the next attempt (Try again can fix a transient camera error)', async () => {
    src.summary = { ...READY, status: 'error', error: { kind: 'inference-failed', message: 'Face/pose detection keeps failing.' } }
    src.ready = { ok: false, reason: 'Face/pose detection keeps failing.' }
    const runner = make()
    const p = runner.runFace()
    await flush()
    expect(src.restarts).toBe(1)
    pump(8000, (t) => ({ face: goodFace(t) }), () => false)
    const r = await p
    expect(r.needsRetry).toBeFalsy()
  })
})
