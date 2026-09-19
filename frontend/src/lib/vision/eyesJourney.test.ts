// JOURNEY tests for the eye check ("gaze not detected" dead end). Drives the REAL runner + REAL analyzeEyes + the retry
// wrapper + session/progress stores exactly like EyeTest / VisionRetryButton do, with a fake camera and fake time.
// Invariants: the check ends in a completed result (a finding when the eyes cannot follow) or offers Try again AND
// Continue without this check after the second failure; a retry never wedges; leaving the screen cancels cleanly.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EYES_CONFIG } from './eyes'
import { EYE_MSG } from './eyeAdvice'
import { targetAt } from './eyeProtocol'
import { useSession } from '../session/store'
import type { Landmark } from './landmarks'
import { useCaptureProgress } from './progressStore'
import { isVisionScreenActive, runVisionWithOneRetry, showsRetryButton, visionActionState, type VisionActionState } from './retry'
import { createTestRunner, type TestRunner } from './useTestRunner'
import type { Detectors, FrameSource, VisionSnapshot, VisionSummary } from './useMediaPipe'

const READY: VisionSummary = { status: 'ready', error: null, delegate: 'CPU', fps: 20, faceDetected: true, poseDetected: true, brightness: 120, videoSize: { w: 1280, h: 720 } }

class FakeSource implements FrameSource {
  latest: VisionSnapshot = { seq: 0, t: 0, face: null, pose: null, brightness: 0, aspect: 16 / 9 }
  summary = READY
  private listeners = new Set<(s: VisionSnapshot) => void>()
  acquired = 0
  released = 0
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
    return Promise.resolve({ ok: true } as const)
  }
  setDetectors(_d: Partial<Detectors>) {}
  push(t: number, face: VisionSnapshot['face']) {
    this.latest = { seq: this.latest.seq + 1, t, face, pose: null, brightness: 130, aspect: 16 / 9 }
    for (const fn of [...this.listeners]) fn(this.latest)
  }
}

interface Person {
  amp?: number // gaze excursion (eye widths) toward the dot; 0 = eyes never leave the center
  yawDeg?: number // head yaw while the dot is off-center
}

/** A face that passes checkFaceFraming (width 0.32, centred) with iris landmarks at a scripted gaze. */
function eyeFace(t: number, gaze: number, yawDeg: number) {
  const lm: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  const ew = 0.07
  lm[33] = { x: 0.4, y: 0.5, z: 0 }
  lm[133] = { x: 0.4 + ew, y: 0.5, z: 0 }
  lm[263] = { x: 0.6, y: 0.5, z: 0 }
  lm[362] = { x: 0.6 - ew, y: 0.5, z: 0 }
  lm[468] = { x: 0.4 + gaze * ew, y: 0.5, z: 0 }
  lm[473] = { x: 0.6 - (1 - gaze) * ew, y: 0.5, z: 0 }
  lm[234] = { x: 0.34, y: 0.55, z: 0 }
  lm[454] = { x: 0.66, y: 0.55, z: 0 }
  return { landmarks: lm, blendshapes: {}, yawDeg, t }
}

const ui = (): VisionActionState => {
  const { running, retryPending } = useCaptureProgress.getState()
  return visionActionState({ running, retryPending, result: useSession.getState().results.eyes, idleGraceElapsed: true })
}

describe('eye check journeys', () => {
  let src: FakeSource
  let clock: number
  let runner: TestRunner
  let holdStart: number | undefined
  let seen: VisionActionState[]

  /** Advance fake time in 50 ms steps; `frame(t, sinceHold)` returns the face the camera sees (null = nobody). */
  const advance = async (ms: number, frame: (t: number, sinceHold: number) => VisionSnapshot['face']) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 50) {
      clock += 50
      await vi.advanceTimersByTimeAsync(50)
      const phase = useCaptureProgress.getState().progress?.phase
      if (useCaptureProgress.getState().running !== 'eyes' || phase !== 'hold') holdStart = undefined
      else holdStart ??= clock
      src.push(clock, frame(clock, holdStart === undefined ? -1 : clock - holdStart))
      await vi.advanceTimersByTimeAsync(0)
      seen.push(ui())
    }
  }
  /** A person following the dot as `p` describes. Before the window opens they look straight ahead. */
  const person = (p: Person = {}) => (t: number, sinceHold: number) => {
    const target = sinceHold < 0 ? 'center' : targetAt(sinceHold)
    const amp = p.amp ?? 0.1
    const gaze = 0.5 + (target === 'left' ? amp : target === 'right' ? -amp : 0)
    const turned = sinceHold >= 0 && target !== 'center' ? (p.yawDeg ?? 0) : 0
    return eyeFace(t, gaze, turned)
  }
  const nobody = () => null

  const mount = () => {
    useSession.setState({ phase: 'eyes', route: 'home' })
    return runVisionWithOneRetry(runner.runEyes, () => isVisionScreenActive('eyes'))
  }
  const pressTryAgain = () => {
    expect(showsRetryButton(ui())).toBe(true)
    return runVisionWithOneRetry(runner.runEyes, () => isVisionScreenActive('eyes'))
  }
  const neverFrozen = () => expect(seen.filter((s) => s === 'starting')).toEqual([])

  beforeEach(() => {
    vi.useFakeTimers()
    src = new FakeSource()
    clock = 1000
    holdStart = undefined
    seen = []
    useSession.getState().reset()
    useCaptureProgress.getState().set(null, null)
    useCaptureProgress.getState().setRetryPending(null)
    runner = createTestRunner({ source: () => src, now: () => clock })
  })
  afterEach(() => vi.useRealTimers())

  it('healthy follower: completes with a low severity and the session moves on to the face check', async () => {
    void mount()
    await advance(16_000, person())
    const r = useSession.getState().results.eyes!
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBeLessThanOrEqual(0.15)
    expect(useSession.getState().phase).toBe('face')
    neverFrozen()
  })

  it('BEHAVIORAL: eyes never leave the center -> a completed moderate finding, NOT a retry and NOT a dead end', async () => {
    void mount()
    await advance(16_000, person({ amp: 0 }))
    const r = useSession.getState().results.eyes!
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBe(EYES_CONFIG.notFollowSeverity)
    expect(r.flags).toContain('eyes did not follow the dot to the left')
    expect(useSession.getState().phase).toBe('face') // the check moved on
    expect(useSession.getState().skipped).not.toContain('eyes') // and it counts (not a silent skip)
    neverFrozen()
  })

  it('TECHNICAL: 1.2 s of nobody in the middle of the window does not fail the run', async () => {
    void mount()
    await advance(4000 + 1600, person()) // intro + framing hold, window opens
    await advance(2000, person())
    await advance(1200, nobody)
    await advance(12_000, person())
    expect(useSession.getState().results.eyes?.needsRetry).toBeFalsy()
    expect(useSession.getState().phase).toBe('face')
  })

  it('TECHNICAL: a head turn inside the window does not abort the capture (the analyzer names it)', async () => {
    void mount()
    await advance(30_000, person({ yawDeg: 25 }))
    const r = useSession.getState().results.eyes!
    expect(r.needsRetry).toBe(true)
    expect(r.flags[0]).toBe(EYE_MSG.headTurned)
    expect(r.metrics.frames_head_turned).toBeGreaterThan(20) // proves the frames were collected, then judged
  })

  it('after BOTH attempts fail: Try again + Continue without this check right away; skipping drops it from the score', async () => {
    void mount()
    await advance(45_000, person({ yawDeg: 25 }))
    expect(ui()).toBe('try-again') // immediately after the second failure, not only after the 15 s skip hatch
    expect(useSession.getState().results.eyes?.flags[0]).toBe(EYE_MSG.headTurned)
    expect(useSession.getState().phase).toBe('eyes') // still here, nothing guessed
    useSession.getState().skipTest('eyes')
    expect(useSession.getState().skipped).toContain('eyes')
    expect(useSession.getState().phase).toBe('face')
    expect(useSession.getState().risk?.contributions.find((c) => c.test === 'eyes')).toBeUndefined()
  })

  it('Try again after a failure works and is not wedged once the head is still', async () => {
    void mount()
    await advance(45_000, person({ yawDeg: 25 }))
    expect(ui()).toBe('try-again')
    void pressTryAgain()
    await advance(14_000, person())
    expect(useSession.getState().results.eyes?.needsRetry).toBeFalsy()
    expect(useSession.getState().phase).toBe('face')
    neverFrozen()
  })

  it('face never in view: both attempts time out with an actionable message and the buttons appear', async () => {
    void mount()
    await advance(45_000, nobody)
    expect(ui()).toBe('try-again')
    expect(useSession.getState().results.eyes?.flags[0]).toBe(EYE_MSG.lostEyes)
    void pressTryAgain()
    await advance(14_000, person())
    expect(useSession.getState().results.eyes?.needsRetry).toBeFalsy()
    neverFrozen()
  })

  it('labels are anchored at the moment the window opened, even when the first frames of the window are unusable', async () => {
    const spy = vi.fn(() => ({ test: 'eyes' as const, severity: 0.1, confidence: 0.9, metrics: {}, flags: [], startedAt: 1, durationMs: 1 }))
    runner = createTestRunner({ source: () => src, now: () => clock, analyzeEyes: spy })
    void mount()
    let windowOpenedAt: number | undefined
    await advance(30_000, (t, since) => {
      if (since >= 0) windowOpenedAt ??= t
      return since >= 0 && since < 1000 ? null : person()(t, since) // no face for the first second of the window
    })
    expect(spy).toHaveBeenCalledTimes(1)
    const [frames, , windowStartT] = spy.mock.calls[0] as unknown as [{ t: number }[], number, number]
    expect(windowStartT).toBeLessThanOrEqual(windowOpenedAt!)
    expect(windowStartT).toBeGreaterThan(1000 + 4000) // after the intro card
    const firstRealFrame = frames.find((f) => f.t >= windowOpenedAt! + 1000)!
    expect(firstRealFrame.t - windowStartT).toBeGreaterThanOrEqual(1000) // not treated as the protocol's t = 0
  })

  it('React StrictMode double mount starts one capture and still finishes', async () => {
    void mount()
    void mount()
    await advance(16_000, person())
    expect(useSession.getState().results.eyes?.needsRetry).toBeFalsy()
    expect(src.acquired).toBe(src.released) // camera hold released
  })

  it('leaving the screen mid-window cancels: nothing is stored and the camera is released', async () => {
    void mount()
    await advance(8000, person()) // inside the window
    expect(useCaptureProgress.getState().running).toBe('eyes')
    useSession.setState({ phase: 'face' }) // skip / next step
    runner.cancel()
    await advance(1000, person())
    expect(useSession.getState().results.eyes).toBeUndefined()
    expect(useCaptureProgress.getState().running).toBeNull()
    expect(src.acquired).toBe(src.released)
  })
})
