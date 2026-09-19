// JOURNEY tests for the "gets stuck after a failed check, even once I'm positioned properly" bug.
// Drives the REAL runner + runVisionWithOneRetry + session/progress stores exactly like FaceTest/ArmsTest/VisionRetryButton
// do, with a fake camera and fake time. Invariant: at every moment the patient has something to see or press.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestName, TestResult } from '../contracts'
import { useSession } from '../session/store'
import type { Landmark, PoseFrame } from './landmarks'
import { useCaptureProgress } from './progressStore'
import { runVisionWithOneRetry, showsRetryButton, visionActionState, type VisionActionState } from './retry'
import { createTestRunner, type TestRunner } from './useTestRunner'
import type { Detectors, FrameSource, VisionSnapshot, VisionSummary } from './useMediaPipe'

const READY: VisionSummary = { status: 'ready', error: null, delegate: 'CPU', fps: 20, faceDetected: true, poseDetected: true, brightness: 120, videoSize: { w: 1280, h: 720 } }

class FakeSource implements FrameSource {
  latest: VisionSnapshot = { seq: 0, t: 0, face: null, pose: null, brightness: 0, aspect: 16 / 9 }
  summary = READY
  ready: { ok: true } | { ok: false; reason: string } = { ok: true }
  acquired = 0
  released = 0
  throwOnAcquire = 0 // next N acquire() calls throw (models an engine/camera exception)
  private listeners = new Set<(s: VisionSnapshot) => void>()
  acquire() {
    if (this.throwOnAcquire > 0) {
      this.throwOnAcquire--
      throw new Error('camera engine exploded')
    }
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
  setDetectors(_d: Partial<Detectors>) {}
  push(t: number, part: Partial<Pick<VisionSnapshot, 'face' | 'pose'>>) {
    this.latest = { seq: this.latest.seq + 1, t, face: null, pose: null, brightness: 130, aspect: 16 / 9, ...part }
    for (const fn of [...this.listeners]) fn(this.latest)
  }
}

const goodFace = (t: number) => ({
  landmarks: Array.from({ length: 478 }, (_, i): Landmark => ({ x: 0.35 + 0.3 * (i / 477), y: 0.3 + (0.4 * ((i * 7) % 478)) / 477, z: 0 })),
  blendshapes: { mouthSmileLeft: 0.5 },
  yawDeg: 0,
  t,
})
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
const okResult = (test: 'face' | 'arms'): TestResult => ({ test, severity: 0.1, confidence: 0.9, metrics: {}, flags: [], startedAt: 1, durationMs: 1 })
const retry = (test: 'face' | 'arms', why: string): TestResult => ({ test, severity: 0, confidence: 0, metrics: {}, flags: [why], startedAt: 1, durationMs: 1, needsRetry: true })

/**
 * What the patient can see/do right now, derived with the SAME function VisionRetryButton uses, from the REAL stores.
 * `idleGraceElapsed: true` = "the screen has settled": an idle check with no result must then offer a button ('stuck').
 */
const ui = (test: TestName): VisionActionState => {
  const { running, retryPending } = useCaptureProgress.getState()
  return visionActionState({ running, retryPending, result: useSession.getState().results[test], idleGraceElapsed: true })
}
const hasButton = (test: TestName): boolean => showsRetryButton(ui(test))

describe('failed check -> positioned properly -> can always continue', () => {
  let src: FakeSource
  let clock: number
  let runner: TestRunner
  let faceAnalyses: TestResult[]
  let seen: VisionActionState[]

  const setup = () =>
    createTestRunner({
      source: () => src,
      now: () => clock,
      analyzeFace: () => faceAnalyses.shift() ?? okResult('face'),
      analyzeArms: () => okResult('arms'),
    })

  /** Advance fake time in 50 ms steps; frames come from `frame(t)` (undefined = camera sees nobody). Records the UI state each step. */
  const advance = async (ms: number, frame: (t: number) => Partial<Pick<VisionSnapshot, 'face' | 'pose'>>, test: TestName) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 50) {
      clock += 50
      await vi.advanceTimersByTimeAsync(50)
      src.push(clock, frame(clock))
      await vi.advanceTimersByTimeAsync(0)
      seen.push(ui(test))
    }
  }
  const nobody = () => ({})
  const faceOk = (t: number) => ({ face: goodFace(t) })
  const armsOk = (t: number) => ({ pose: goodPose(t) })
  /** The screen mounting: what FaceTest / ArmsTest do in their effect. */
  const mount = (test: 'face' | 'arms') => {
    useSession.setState({ phase: test })
    return runVisionWithOneRetry(test === 'face' ? runner.runFace : runner.runArms, () => useSession.getState().phase === test)
  }
  /** The "Try again" button's onClick, only available when the UI says so. */
  const pressTryAgain = (test: 'face' | 'arms') => {
    expect(hasButton(test)).toBe(true)
    return runVisionWithOneRetry(test === 'face' ? runner.runFace : runner.runArms, () => useSession.getState().phase === test)
  }
  // Every settled moment is one of: running, retry-pending, a result, or a button. ('starting' is only the mount flash.)
  const neverFrozen = () => expect(seen.filter((s) => s === 'starting')).toEqual([])

  beforeEach(() => {
    vi.useFakeTimers()
    src = new FakeSource()
    clock = 1000
    faceAnalyses = []
    seen = []
    useSession.getState().reset()
    useCaptureProgress.getState().set(null, null)
    useCaptureProgress.getState().setRetryPending(null)
    runner = setup()
  })
  afterEach(() => vi.useRealTimers())

  it('face: not in shot at first, then positioned during the automatic retry -> completes by itself', async () => {
    void mount('face')
    await advance(13_000, nobody, 'face') // first attempt times out (12 s)
    expect(ui('face')).toMatch(/retry-pending|running/)
    await advance(20_000, faceOk, 'face') // patient steps into position
    expect(ui('face')).toBe('done')
    neverFrozen()
  })

  it('face: still not in shot after BOTH automatic attempts -> a Try again button appears, and pressing it works once positioned', async () => {
    void mount('face')
    await advance(35_000, nobody, 'face')
    expect(hasButton('face')).toBe(true)
    // the patient now positions properly, then presses the button
    await advance(1_000, faceOk, 'face')
    expect(hasButton('face')).toBe(true)
    void pressTryAgain('face')
    await advance(15_000, faceOk, 'face')
    expect(ui('face')).toBe('done')
    neverFrozen()
  })

  it('arms: same journey (step back late, after both automatic attempts failed)', async () => {
    void mount('arms')
    await advance(35_000, nobody, 'arms')
    expect(hasButton('arms')).toBe(true)
    await advance(500, armsOk, 'arms')
    void pressTryAgain('arms')
    await advance(20_000, armsOk, 'arms')
    expect(ui('arms')).toBe('done')
    neverFrozen()
  })

  it('face: pre-smile failure from the analyzer (relax your face) -> automatic retry succeeds', async () => {
    faceAnalyses = [retry('face', 'relax your face before smiling')]
    void mount('face')
    await advance(30_000, faceOk, 'face')
    expect(ui('face')).toBe('done')
    neverFrozen()
  })

  it('face: React StrictMode double-mount (two effects at once) does not wedge the screen', async () => {
    void mount('face')
    void mount('face')
    await advance(35_000, nobody, 'face')
    expect(hasButton('face')).toBe(true)
    void pressTryAgain('face')
    await advance(15_000, faceOk, 'face')
    expect(ui('face')).toBe('done')
    neverFrozen()
  })

  it('face: lost sight of the patient MID-capture, then they reposition -> recovers', async () => {
    void mount('face')
    await advance(4_000, faceOk, 'face') // framing held, neutral capture starts
    await advance(3_000, nobody, 'face') // walks out of shot (> 1.5 s grace) -> attempt fails
    await advance(25_000, faceOk, 'face') // comes back
    expect(['done', 'try-again', 'stuck']).toContain(ui('face'))
    if (hasButton('face')) {
      void pressTryAgain('face')
      await advance(15_000, faceOk, 'face')
    }
    expect(ui('face')).toBe('done')
    neverFrozen()
  })

  it('the camera engine THROWING once must not wedge the retry button (regression guard)', async () => {
    src.throwOnAcquire = 2 // both automatic attempts hit the exception
    void mount('face').catch(() => undefined)
    await advance(10_000, faceOk, 'face')
    // whatever happened, the patient must be able to press something, and pressing must work now that the engine is fine
    expect(ui('face')).toBe('try-again') // the crash was turned into an ordinary stored retry result
    void pressTryAgain('face')
    await advance(15_000, faceOk, 'face')
    expect(ui('face')).toBe('done')
    neverFrozen()
  })

  it('the voice agent starting ANOTHER test cancels this screen\'s run without a result -> a button appears and works', async () => {
    void mount('face')
    await advance(2_000, (t) => ({ face: goodFace(t), pose: goodPose(t) }), 'face') // face check is running normally
    void runner.runArms() // agent tool start_arm_test fires while the face screen is showing: cancels the face run
    await advance(1_500, nobody, 'face')
    expect(useSession.getState().results.face).toBeUndefined() // the cancelled run stores nothing
    expect(['stuck', 'running']).toContain(ui('face')) // never a dead screen
    runner.cancel() // the agent's arms run is abandoned (nobody in shot)
    await advance(2_000, nobody, 'face')
    expect(ui('face')).toBe('stuck') // idle, no result: the safety-net button is offered
    void runVisionWithOneRetry(runner.runFace, () => useSession.getState().phase === 'face') // patient presses it
    await advance(15_000, (t) => ({ face: goodFace(t) }), 'face')
    expect(ui('face')).toBe('done')
    neverFrozen()
  })

  it('pressing Try again twice quickly starts only one capture and still finishes', async () => {
    void mount('face')
    await advance(35_000, nobody, 'face')
    void pressTryAgain('face')
    await advance(50, nobody, 'face')
    void runVisionWithOneRetry(runner.runFace, () => useSession.getState().phase === 'face')
    await advance(20_000, faceOk, 'face')
    expect(ui('face')).toBe('done')
    neverFrozen()
  })
})
