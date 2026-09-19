// Capture controller: PURE, injectable-clock state machine (no DOM, no timers, no MediaPipe).
// The caller feeds it one `tick(now, { framing, frame })` per camera frame (plus a heartbeat with frame=null when the
// camera stalls) and reads back a CaptureProgress for captions. Protocols are from docs/spec/02-vision.md:
//   FACE : wait for framing OK held holdOkMs -> "Serious face, lips closed" neutral -> "Now smile..." 3 s smile -> analyze
//   ARMS : wait for framing OK held holdOkMs -> 3-2-1 cue -> 10 s hold window -> analyze
// Frames are collected only while framing is acceptable. Framing lost for too long / too much of a segment, or never
// OK within waitTimeoutMs => a `needsRetry` result with a spoken-style first flag (never a guess).
//
//   EYES : wait for framing OK (face gate + tighter yaw limit) -> one window the length of the dot sequence -> analyze
// `createEyesCapture` is wired (FEATURES.eyesTest); the UI renders EyeStimulus while that window runs.
import { FRAMING_LIMITS } from '../config'
import type { TestName, TestResult } from '../contracts'
import { EYE_MSG, eyeWaitTimeoutMessage } from './eyeAdvice'
import { EYE_PROTOCOL_TOTAL_MS } from './eyeProtocol'
import type { Framing } from './framing'

/** Protocol timings (ms unless noted). From spec 02; framing hold/timeout come from FRAMING_LIMITS. */
export const CAPTURE_TIMING = {
  // Generous on purpose: people need a moment to settle into a relaxed face and then a big smile. The neutral phase
  // doubles as the lead-in (the analyzer only needs its frames as a baseline), so a slow start no longer fails the run.
  faceNeutralMs: 3000,
  faceSmileMs: 5000,
  armsCueSeconds: 3,
  armsHoldMs: 10_000,
  framingLossGraceMs: 3000, // framing bad continuously this long during a capture => retry (time to re-adjust)
  minCoverage: 0.6, // fraction of a capture segment's time that framing must have been OK, else retry
  maxDtMs: 250, // a single gap between ticks counts for at most this much coverage time
  introMs: 4000, // face / eyes: how long the instruction card is shown, alone, before anything is measured
  // EYES only (UNCALIBRATED): the analyzer, not the controller, decides whether enough of the 7 s window was usable
  // (partial protocol), so the controller only bails out when almost nothing was seen.
  eyesLossGraceMs: 5000, // framing bad continuously this long inside the window => retry (window is 7 s)
  eyesMinCoverage: 0.25, // fraction of the window that must have had a usable face at all
} as const

export type CapturePhase = 'intro' | 'waiting' | 'cue' | 'neutral' | 'smile' | 'hold' | 'done' | 'cancelled'

export interface CaptureProgress {
  test: TestName
  phase: CapturePhase
  /** Big instruction text for the current phase ('' when there is nothing to say). */
  caption: string
  /** Live positioning hint (framing gate) or the retry reason once finished. */
  hint: string
  /** Whole seconds left in a timed phase (cue/neutral/smile/hold), else null. */
  secondsLeft: number | null
  /** Progress of the current phase, 0..1. */
  fraction: number
  framingOk: boolean
}

export interface CaptureInput<F> {
  framing: Framing
  /** The latest frame, or null when no face/pose was detected. */
  frame: F | null
  /**
   * Whether the frame counts while a capture step runs, when that differs from the pre-start `framing` verdict (eyes:
   * the yaw gate applies before the dot starts, but inside the window turned-head frames are kept and rejected by the
   * analyzer, so a brief turn cannot fail the whole run). Defaults to `framing.ok`.
   */
  captureOk?: boolean
}

/** Info the controller hands to `analyze` besides the frames. */
export interface CaptureInfo {
  /** Timestamp (same clock as the ticks) at which each capture step began, in step order. */
  segmentStarts: number[]
}

type Step =
  | { kind: 'cue'; phase: CapturePhase; ms: number; caption: string }
  | {
      kind: 'capture'
      phase: CapturePhase
      ms: number
      caption: string
      /** Overrides of CAPTURE_TIMING for this step (eyes tolerates far more loss; the analyzer judges the rest). */
      minCoverage?: number
      lossGraceMs?: number
      lossFlag?: string
      coverageFlag?: string
    }

interface ControllerConfig<F> {
  test: TestName
  steps: Step[] // the steps AFTER the implicit initial framing wait
  waitCaption: string
  waitTimeoutFlag: string | ((lastHint: string) => string) // spoken-style reason when framing never became OK
  /** Called with the frames of each 'capture' step, in order. Must not throw (if it does we return a retry result). */
  analyze: (segments: F[][], info: CaptureInfo) => TestResult
  /** Frame to store when nothing was detected during a capture (e.g. an empty-landmarks face frame). Omit to skip. */
  missingFrame?: (t: number) => F
  /** Epoch clock for result.startedAt (injected in tests). */
  wallClock?: () => number
  /** How long to show `introCaption` on its own before the framing wait even starts (0 / omitted = no intro). */
  introMs?: number
  introCaption?: string
}

/**
 * Adds a head-yaw check on top of a framing verdict (framing.ts stays untouched): while the framing itself is OK but the
 * head is turned more than `limitDeg`, the verdict becomes "not ok" with a "look straight" hint. `yawDeg` undefined
 * (no matrix) does not block. Limits: FACE_CONFIG.yawFullDeg (face), EYES_CONFIG.maxYawDeg (eyes).
 */
export function withYawGate(framing: Framing, yawDeg: number | undefined, limitDeg: number): Framing {
  if (!framing.ok || yawDeg === undefined || Math.abs(yawDeg) <= limitDeg) return framing
  return { ok: false, hint: 'Look straight at the screen.' }
}

export function retryResult(test: TestName, reason: string, startedAt: number, durationMs: number): TestResult {
  return { test, severity: 0, confidence: 0, metrics: {}, flags: [reason], startedAt, durationMs, needsRetry: true }
}

export class CaptureController<F> {
  private phase: CapturePhase = 'waiting'
  private stepIdx = -1 // -1 = waiting for framing
  private began: number | undefined
  private introEnd = 0
  private lastTick = 0
  private waitStart = 0
  private okSince: number | undefined
  private stepStart = 0
  private lostSince: number | undefined
  private okMs = 0
  private totalMs = 0
  private segments: F[][] = []
  private segmentStarts: number[] = []
  private startedAtEpoch = 0
  private lastFraming: Framing = { ok: false, hint: '' }
  private final: TestResult | undefined

  private readonly cfg: ControllerConfig<F>

  constructor(cfg: ControllerConfig<F>) {
    this.cfg = cfg
  }

  get finished(): boolean {
    return this.final !== undefined
  }
  /** The finished result (the analysis, a retry result, or the 'cancelled' retry result). */
  get result(): TestResult | undefined {
    return this.final
  }
  get cancelled(): boolean {
    return this.phase === 'cancelled'
  }

  cancel(): void {
    if (this.final) return
    this.phase = 'cancelled'
    this.final = retryResult(this.cfg.test, 'Cancelled.', this.startedAtEpoch, this.elapsed(this.lastTick))
  }

  tick(now: number, input: CaptureInput<F>): CaptureProgress {
    if (this.final) return this.progress(now)
    if (this.began === undefined) {
      this.began = now
      this.waitStart = now
      this.lastTick = now
      this.startedAtEpoch = (this.cfg.wallClock ?? Date.now)()
      this.introEnd = now + (this.cfg.introMs ?? 0)
    }
    const dt = Math.min(Math.max(now - this.lastTick, 0), CAPTURE_TIMING.maxDtMs)
    this.lastTick = now
    this.lastFraming = input.framing

    if (now < this.introEnd) {
      // Instruction card only: nothing is measured and the framing-wait timeout has not started.
      this.waitStart = this.introEnd
    } else if (this.stepIdx < 0) this.tickWaiting(now, input)
    else {
      const step = this.cfg.steps[this.stepIdx]
      if (step.kind === 'cue') this.tickCue(now, input, step)
      else this.tickCapture(now, input, step, dt)
    }
    return this.progress(now)
  }

  private tickWaiting(now: number, { framing }: CaptureInput<F>): void {
    if (framing.ok) {
      this.okSince ??= now
      if (now - this.okSince >= FRAMING_LIMITS.holdOkMs) return this.enterStep(now, 0)
    } else this.okSince = undefined
    if (now - this.waitStart >= FRAMING_LIMITS.waitTimeoutMs) {
      const flag = this.cfg.waitTimeoutFlag
      this.fail(now, typeof flag === 'function' ? flag(this.lastFraming.hint) : flag)
    }
  }

  private tickCue(now: number, { framing }: CaptureInput<F>, step: Step): void {
    if (!framing.ok) {
      // Patient moved during the cue: go back to waiting (restart the hold and the wait timeout).
      this.stepIdx = -1
      this.phase = 'waiting'
      this.okSince = undefined
      this.waitStart = now
      return
    }
    if (now - this.stepStart >= step.ms) this.enterStep(now, this.stepIdx + 1)
  }

  private tickCapture(now: number, { framing, frame, captureOk }: CaptureInput<F>, step: Step, dt: number): void {
    const seg = this.segments[this.segments.length - 1]
    const grace = (step.kind === 'capture' && step.lossGraceMs) || CAPTURE_TIMING.framingLossGraceMs
    const minCoverage = (step.kind === 'capture' && step.minCoverage) || CAPTURE_TIMING.minCoverage
    if ((captureOk ?? framing.ok) && frame) {
      seg.push(frame)
      this.okMs += dt
      this.lostSince = undefined
    } else {
      this.lostSince ??= now
      if (!frame && this.cfg.missingFrame) seg.push(this.cfg.missingFrame(now))
      if (now - this.lostSince > grace) {
        return this.fail(now, (step.kind === 'capture' && step.lossFlag) || "I lost sight of you. Let's try that again.")
      }
    }
    this.totalMs += dt
    if (now - this.stepStart < step.ms) return
    if (this.totalMs > 0 && this.okMs / this.totalMs < minCoverage) {
      return this.fail(now, (step.kind === 'capture' && step.coverageFlag) || "I couldn't see you steadily enough. Let's try that again.")
    }
    this.enterStep(now, this.stepIdx + 1)
  }

  private enterStep(now: number, idx: number): void {
    if (idx >= this.cfg.steps.length) return this.complete(now)
    const step = this.cfg.steps[idx]
    this.stepIdx = idx
    this.phase = step.phase
    this.stepStart = now
    this.lostSince = undefined
    this.okMs = 0
    this.totalMs = 0
    if (step.kind === 'capture') {
      this.segments.push([])
      this.segmentStarts.push(now)
    }
  }

  private complete(now: number): void {
    const duration = this.elapsed(now)
    let res: TestResult
    try {
      res = this.cfg.analyze(this.segments, { segmentStarts: this.segmentStarts })
    } catch (e) {
      console.debug('[capture] analyze threw', e)
      res = retryResult(this.cfg.test, "Something went wrong measuring that. Let's try again.", this.startedAtEpoch, duration)
    }
    this.final = { ...res, durationMs: res.durationMs > 0 ? res.durationMs : duration, startedAt: res.startedAt || this.startedAtEpoch }
    this.phase = 'done'
  }

  private fail(now: number, reason: string): void {
    this.final = retryResult(this.cfg.test, reason, this.startedAtEpoch, this.elapsed(now))
    this.phase = 'done'
  }

  private elapsed(now: number): number {
    return this.began === undefined ? 0 : Math.max(0, now - this.began)
  }

  private progress(now: number): CaptureProgress {
    const base = { test: this.cfg.test, framingOk: this.lastFraming.ok }
    if (this.final) {
      const retry = this.final.needsRetry
      return {
        ...base,
        phase: this.phase,
        caption: this.phase === 'cancelled' ? '' : retry ? '' : 'Done',
        hint: retry ? (this.final.flags[0] ?? '') : '',
        secondsLeft: null,
        fraction: 1,
      }
    }
    if (now < this.introEnd) {
      const total = this.cfg.introMs ?? 1
      return {
        ...base,
        phase: 'intro',
        caption: this.cfg.introCaption ?? '',
        hint: '',
        secondsLeft: Math.ceil((this.introEnd - now) / 1000),
        fraction: 1 - (this.introEnd - now) / total,
      }
    }
    if (this.stepIdx < 0) {
      const held = this.okSince === undefined ? 0 : (now - this.okSince) / FRAMING_LIMITS.holdOkMs
      return {
        ...base,
        phase: 'waiting',
        caption: this.cfg.waitCaption,
        hint: this.lastFraming.hint,
        secondsLeft: null,
        fraction: Math.min(1, held),
      }
    }
    const step = this.cfg.steps[this.stepIdx]
    const spent = Math.min(step.ms, Math.max(0, now - this.stepStart))
    return {
      ...base,
      phase: step.phase,
      caption: step.caption,
      hint: this.lastFraming.ok ? '' : this.lastFraming.hint,
      secondsLeft: Math.ceil((step.ms - spent) / 1000),
      fraction: spent / step.ms,
    }
  }
}

export interface CaptureOptions<F> {
  /** Frame to store when nothing is detected during a capture (face: an empty-landmarks frame). */
  missingFrame?: (t: number) => F
  wallClock?: () => number
  /** Show the instruction card this long before starting (see CAPTURE_TIMING.introMs). Omit for none. */
  introMs?: number
}

/** FACE protocol. `analyze(neutral, smile)` is injected (see useTestRunner.ts adapter). */
export function createFaceCapture<F>(
  analyze: (neutral: F[], smile: F[]) => TestResult,
  opts: CaptureOptions<F> = {},
): CaptureController<F> {
  return new CaptureController<F>({
    test: 'face',
    introCaption: 'Make your face serious. Smile when prompted.',
    waitCaption: 'Look at the camera',
    waitTimeoutFlag: "I couldn't see your face clearly. Let's try again.",
    steps: [
      { kind: 'capture', phase: 'neutral', ms: CAPTURE_TIMING.faceNeutralMs, caption: 'Serious face, lips closed' },
      { kind: 'capture', phase: 'smile', ms: CAPTURE_TIMING.faceSmileMs, caption: 'Now smile as big as you can and hold' },
    ],
    analyze: ([neutral, smile]) => analyze(neutral, smile),
    ...opts,
  })
}

/** ARMS protocol. `analyze(frames)` gets ONLY the hold window (after the cue). */
export function createArmsCapture<F>(
  analyze: (frames: F[]) => TestResult,
  opts: CaptureOptions<F> = {},
): CaptureController<F> {
  return new CaptureController<F>({
    test: 'arms',
    waitCaption: 'Step back so I can see both hands',
    waitTimeoutFlag: "I couldn't see both hands. Let's try again.",
    steps: [
      { kind: 'cue', phase: 'cue', ms: CAPTURE_TIMING.armsCueSeconds * 1000, caption: 'Get ready… raise your arms' },
      {
        kind: 'capture',
        phase: 'hold',
        ms: CAPTURE_TIMING.armsHoldMs,
        caption: 'Hold both arms straight out to your sides, palms up',
      },
    ],
    analyze: ([frames]) => analyze(frames),
    ...opts,
  })
}

/**
 * EYES protocol (BE-FAST stretch, FEATURES.eyesTest). One capture window the length of the whole dot sequence
 * (EYE_PROTOCOL_TOTAL_MS); the on-screen stimulus runs alongside it and the caller labels each frame with the dot
 * target afterwards via `labelEyeFrames`, anchored at `info.segmentStarts[0]` (the moment the window, and so the dot,
 * began: NOT the first collected frame, which can be later when the first frames were unusable).
 * Same framing gate as the face test before the dot starts, plus the EYES_CONFIG yaw limit because the head must stay
 * still. INSIDE the window the yaw gate is not applied (callers pass `captureOk`), loss tolerances are much looser
 * (CAPTURE_TIMING.eyes*) and frames lost to a missing face are recorded as empty frames, so the analyzer can score the
 * usable segments (partial protocol) or name the specific cause instead of the whole run failing on a brief dropout.
 */
export function createEyesCapture<F>(
  analyze: (frames: F[], info: CaptureInfo) => TestResult,
  opts: CaptureOptions<F> = {},
): CaptureController<F> {
  return new CaptureController<F>({
    test: 'eyes',
    introCaption: 'Keep your head still. Follow the dot with your eyes only.',
    waitCaption: 'Look straight at the camera',
    waitTimeoutFlag: eyeWaitTimeoutMessage,
    steps: [
      {
        kind: 'capture',
        phase: 'hold',
        ms: EYE_PROTOCOL_TOTAL_MS,
        caption: 'Follow the dot with your eyes — keep your head still',
        minCoverage: CAPTURE_TIMING.eyesMinCoverage,
        lossGraceMs: CAPTURE_TIMING.eyesLossGraceMs,
        lossFlag: EYE_MSG.lostEyes,
        coverageFlag: EYE_MSG.lostEyes,
      },
    ],
    analyze: ([frames], info) => analyze(frames, info),
    ...opts,
  })
}
