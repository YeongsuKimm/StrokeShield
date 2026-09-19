// Runner-level robustness with a fake camera: bystanders, the camera dying mid-run, 20 consecutive runs without leaking
// subscriptions/timers/camera holds, and UI publish throttling under a fast, flickering frame stream.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestResult } from '../contracts'
import type { CaptureProgress } from './capture'
import type { FaceCaptureFrame } from './face'
import type { Landmark, PoseFrame } from './landmarks'
import { ONE_PERSON_HINT, SWITCHED_PERSON_HINT, type SubjectInfo } from './subject'
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

class Source implements FrameSource {
  latest: VisionSnapshot = { seq: 0, t: 0, face: null, pose: null, brightness: 130, aspect: 16 / 9 }
  summary: VisionSummary = READY
  acquired = 0
  released = 0
  frameListeners = new Set<(s: VisionSnapshot) => void>()
  summaryListeners = new Set<() => void>()
  restarts = 0
  restart() {
    this.restarts++
    this.summary = READY
  }
  acquire() {
    this.acquired++
    return () => void this.released++
  }
  subscribeFrames(fn: (s: VisionSnapshot) => void) {
    this.frameListeners.add(fn)
    return () => void this.frameListeners.delete(fn)
  }
  subscribeSummary(fn: () => void) {
    this.summaryListeners.add(fn)
    return () => void this.summaryListeners.delete(fn)
  }
  waitUntilReady() {
    return Promise.resolve(this.summary.status === 'error' ? { ok: false as const, reason: this.summary.error?.message ?? '' } : { ok: true as const })
  }
  setDetectors(_d: Partial<Detectors>) {}
  push(t: number, part: Partial<Pick<VisionSnapshot, 'face' | 'pose' | 'subject'>>) {
    this.latest = { seq: this.latest.seq + 1, t, face: null, pose: null, brightness: 130, aspect: 16 / 9, ...part }
    for (const fn of [...this.frameListeners]) fn(this.latest)
  }
  fail(message: string) {
    this.summary = { ...READY, status: 'error', error: { kind: 'unknown', message } }
    for (const fn of [...this.summaryListeners]) fn()
  }
}

const goodFace = (t: number) => ({
  landmarks: Array.from({ length: 478 }, (_, i): Landmark => ({ x: 0.35 + 0.3 * (i / 477), y: 0.3 + (0.4 * ((i * 7) % 478)) / 477, z: 0 })),
  blendshapes: {},
  yawDeg: 0,
  t,
})
const goodPose = (t: number): PoseFrame => {
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }))
  const set = (i: number, x: number, y: number) => (lm[i] = { x, y, z: 0, visibility: 1 })
  set(11, 0.6, 0.4)
  set(12, 0.4, 0.4)
  set(13, 0.75, 0.4)
  set(14, 0.25, 0.4)
  set(15, 0.9, 0.4)
  set(16, 0.1, 0.4)
  return { landmarks: lm, t }
}
const ok = (test: 'face' | 'arms' | 'eyes'): TestResult => ({ test, severity: 0.1, confidence: 0.9, metrics: {}, flags: [], startedAt: 1, durationMs: 1 })
const subj = (over: Partial<SubjectInfo> = {}): SubjectInfo => ({ bystanders: 0, ambiguous: false, epoch: 0, ...over })

describe('runner robustness', () => {
  let src: Source
  let clock: number
  const published: { t: number; p: CaptureProgress | null }[] = []
  const hints: (string | undefined)[] = []
  const analyzeFace = vi.fn<(n: FaceCaptureFrame[], s: FaceCaptureFrame[]) => TestResult>(() => ok('face'))
  const analyzeArms = vi.fn<(f: PoseFrame[], a: number) => TestResult>(() => ok('arms'))
  const make = () =>
    createTestRunner({
      source: () => src,
      completeTest: () => {},
      setHint: (h) => void hints.push(h),
      publish: (_r, p) => void published.push({ t: clock, p }),
      analyzeFace,
      analyzeArms,
      now: () => clock,
    })
  const flush = () => vi.advanceTimersByTimeAsync(0)
  /** Feed frames at `fps` for `ms` of fake time (or until `done`). */
  const pump = (ms: number, fps: number, frameAt: (t: number) => Partial<Pick<VisionSnapshot, 'face' | 'pose' | 'subject'>>, done: () => boolean) => {
    const dt = 1000 / fps
    const end = clock + ms
    for (let t = clock; t <= end && !done(); t += dt) {
      clock = t
      src.push(t, frameAt(t))
    }
    clock = end
  }

  beforeEach(() => {
    vi.useFakeTimers()
    src = new Source()
    clock = 1000
    published.length = 0
    hints.length = 0
    analyzeFace.mockClear()
    analyzeArms.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('two similar-size people: the run waits with "one person at a time" and never starts measuring', async () => {
    const runner = make()
    let settled = false
    const p = runner.runArms().then((r) => ((settled = true), r))
    await flush()
    pump(20_000, 20, (t) => ({ pose: goodPose(t), subject: subj({ bystanders: 1, ambiguous: true }) }), () => settled)
    await flush()
    const r = await p
    expect(r.needsRetry).toBe(true)
    expect(analyzeArms).not.toHaveBeenCalled()
    expect(hints).toContain(ONE_PERSON_HINT)
  })

  it('a small bystander does not block the run (only a reminder)', async () => {
    const runner = make()
    let settled = false
    const p = runner.runArms().then((r) => ((settled = true), r))
    await flush()
    pump(30_000, 20, (t) => ({ pose: goodPose(t), subject: subj({ bystanders: 1 }) }), () => settled)
    await flush()
    expect((await p).needsRetry).toBeFalsy()
    expect(analyzeArms).toHaveBeenCalledOnce()
  })

  it('the tracker switching to a different person mid-capture loses those frames instead of mixing them in', async () => {
    const runner = make()
    let settled = false
    const p = runner.runFace().then((r) => ((settled = true), r))
    await flush()
    // stable epoch 0 through the intro, the hold and into the neutral capture
    pump(6500, 20, (t) => ({ face: goodFace(t), subject: subj({ epoch: 0 }) }), () => settled)
    // then the subject is replaced (walked out, someone else in the same place)
    pump(20_000, 20, (t) => ({ face: goodFace(t), subject: subj({ epoch: 1 }) }), () => settled)
    await flush()
    const r = await p
    expect(r.needsRetry).toBe(true)
    expect(analyzeFace).not.toHaveBeenCalled()
    expect(hints).toContain(SWITCHED_PERSON_HINT)
  })

  it('the camera dying mid-run ends the run at once with the reason (no waiting out a frozen picture)', async () => {
    const runner = make()
    let settled = false
    const p = runner.runArms().then((r) => ((settled = true), r))
    await flush()
    pump(3000, 20, (t) => ({ pose: goodPose(t) }), () => settled)
    src.fail('The camera stopped. It may have been unplugged.')
    await flush()
    expect(settled).toBe(true)
    const r = await p
    expect(r.needsRetry).toBe(true)
    expect(r.flags[0]).toMatch(/lost the camera.*unplugged/i)
    expect(src.summaryListeners.size).toBe(0)
    expect(src.frameListeners.size).toBe(0)
    expect(src.released).toBe(src.acquired)
    // the next attempt reopens the camera (the engine sits in 'error' until restarted)
    src.summary = { ...READY, status: 'error', error: { kind: 'unknown', message: 'x' } }
    const again = runner.runArms()
    await flush()
    expect(src.restarts).toBe(1)
    runner.cancel()
    await again
  })

  it('20 consecutive runs (all three tests, some cancelled, some failed) leave no subscriptions, timers or camera holds', async () => {
    const runner = make()
    const timersAtStart = vi.getTimerCount()
    for (let i = 0; i < 20; i++) {
      const kind = (['face', 'arms', 'eyes'] as const)[i % 3]
      const started = kind === 'face' ? runner.runFace() : kind === 'arms' ? runner.runArms() : runner.runEyes()
      await flush()
      if (i % 4 === 3) {
        runner.cancel() // cancelled mid-wait
      } else if (i % 4 === 2) {
        src.fail('camera gone') // fails mid-run
        src.summary = READY
      } else {
        let settled = false
        void started.then(() => (settled = true))
        pump(6000, 20, (t) => (kind === 'arms' ? { pose: goodPose(t) } : { face: goodFace(t) }), () => settled)
        runner.cancel()
      }
      await started
      await flush()
      expect(src.frameListeners.size).toBe(0)
      expect(src.summaryListeners.size).toBe(0)
      expect(src.released).toBe(src.acquired)
      expect(runner.running).toBeNull()
    }
    expect(src.acquired).toBe(20)
    expect(vi.getTimerCount()).toBe(timersAtStart)
  })

  it('progress updates reach the UI at <= 5 Hz even at 30 fps with a hint flickering every frame', async () => {
    const runner = make()
    let settled = false
    const p = runner.runArms().then((r) => ((settled = true), r))
    await flush()
    // shoulders too narrow every other frame => framing hint alternates each frame
    const flicker = (t: number, n: number): PoseFrame => {
      const f = goodPose(t)
      if (n % 2) {
        f.landmarks[11] = { x: 0.53, y: 0.4, z: 0, visibility: 1 }
        f.landmarks[12] = { x: 0.47, y: 0.4, z: 0, visibility: 1 }
      }
      return f
    }
    let n = 0
    published.length = 0
    pump(6000, 30, (t) => ({ pose: flicker(t, n++) }), () => settled)
    await flush()
    const inWindow = published.filter((x) => x.t >= 1000 && x.t <= 7000)
    expect(inWindow.length).toBeLessThanOrEqual(5 * 6 + 4) // <= 5 Hz plus a few phase changes
    runner.cancel()
    await p
  })

  it('a full synthetic 30 fps arms run costs little per frame and publishes a bounded number of updates', async () => {
    const runner = make()
    let settled = false
    const p = runner.runArms().then((r) => ((settled = true), r))
    await flush()
    const frames = Array.from({ length: 600 }, (_, i) => goodPose(1000 + i * 33.3))
    let i = 0
    const t0 = performance.now()
    pump(20_000, 30, () => ({ pose: frames[Math.min(i++, frames.length - 1)] }), () => settled)
    const wall = performance.now() - t0
    await flush()
    await p
    expect(i).toBeGreaterThan(400)
    // CPU time of the runner + capture controller per delivered frame (fake timers, no rendering): generous ceiling.
    expect(wall / i).toBeLessThan(2)
    expect(published.length).toBeLessThan(5 * 16 + 30)
  })
})
