// OWNER: Vision dev. Spec: docs/spec/02-vision.md "Arms test". PURE function: no DOM, no network, no globals.
//
// LEFT/RIGHT MAPPING: ASSUMED, NOT YET VERIFIED ON A LIVE CAMERA.
//   BlazePose landmarks 11/13/15 (shoulder/elbow/wrist "left") are the SUBJECT'S anatomical left; 12/14/16 are the
//   subject's right. In a RAW (unmirrored) camera frame the subject's left therefore appears on the IMAGE RIGHT
//   (larger x). The MediaPipe Pose Landmarker docs (developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)
//   only list "11 - left shoulder ..." and say nothing about mirroring, so this is the standard convention, not a
//   documented guarantee. `side` is reported as the PATIENT'S left/right, i.e. landmark 11/13/15 => 'left'.
//   TODO(live camera): raise the patient's LEFT arm and confirm with the debug overlay that landmark 15 is that wrist
//   and sits on the image-right of the raw frame. If not, flip `ARMS_CONFIG.swapLeftRight`.
//
// GEOMETRY: landmarks are normalized separately by frame width (x) and height (y), so atan2 on raw normalized values
// distorts angles unless the aspect ratio is corrected. We convert dx to height units (dx * aspectRatio). Callers should
// pass the real video aspect ratio (videoWidth / videoHeight); the default is only a guess.
import { epochStartedAt } from './time'
import type { TestResult, Side } from '../contracts'
import { FRAMING_LIMITS, MIN_CONFIDENCE } from '../config'
import { clamp01, median, ramp } from '../math'
import { POSE, type Landmark, type PoseFrame } from './landmarks'

/**
 * All arms-test thresholds, ramps and weights. UNCALIBRATED: tune on teammate recordings (docs/spec/05).
 * Visibility / edge margin / min shoulder width come from FRAMING_LIMITS and the retry cutoff from MIN_CONFIDENCE
 * (config.ts, read-only here). Angles in degrees, times in ms unless noted.
 * Severity anchors (shared across face/arms/eyes): natural mild asymmetry <= 0.15, borderline ~0.3-0.4, clear deficit >= 0.85.
 */
export const ARMS_CONFIG = {
  swapLeftRight: false, // bool: flip if the live-camera check shows landmark 11/13/15 is the patient's RIGHT side
  defaultAspectRatio: 16 / 9, // width/height of the raw video; used only when the caller does not pass one

  smoothWindow: 5, // frames: centred median smoothing of theta
  edgeWindowMs: 2000, // ms: "first 2 s" / "last 2 s" windows for drift
  minWindowSamples: 5, // count: valid smoothed samples needed in each edge window
  sustainMs: 1000, // ms: "sustained" theta = rolling median over this window (min_theta, never-rose check)

  // Hard data-sufficiency gates: below these => needsRetry, never a guess.
  minDurationMs: 6000, // ms: spec says >= ~6 s of data
  minValidFrames: 30, // count: frames with all 6 joints visible, in frame, shoulders wide enough

  // Severity = wDrift*ramp(drift_asym) + wHeight*ramp(height_diff) + wNever*[exactly one arm never rose].
  // Spec weights were 0.55/0.25/0.20 (max 0.80 without never-rose); changed to reach the >= 0.85 "clear deficit" anchor.
  weights: { driftAsym: 0.6, heightDiff: 0.3, neverRose: 0.1 }, // unitless, sum 1
  driftAsymRamp: { lo: 8, hi: 25 }, // deg: |drift_left - drift_right|; <= lo is normal, >= hi is clear (spec was 8->30)
  heightDiffRamp: { lo: 0.1, hi: 0.4 }, // wrist height gap / shoulder width, mean over hold (spec was 0.08->0.35)
  neverRoseDeg: -10, // deg: sustained theta never above this => the arm never rose
  droppedDeg: -25, // deg: sustained theta below this => "arm dropped" flag
  raisedWithinDeg: 20, // deg: raised_time counts seconds until theta falls this far below the starting theta
  bothDriftMinDeg: 8, // deg: both arms drifted at least this much (and equally) => fatigue flag
  // Spec formula alone gives ~0.4 for "one arm never rises" (no drift => asym ~0), but the spec calls that severe.
  severityFloorNeverRose: 0.9, // severity floor when exactly one arm never rose

  // Confidence = min(visibility score, duration score); needsRetry when < MIN_CONFIDENCE (config.ts).
  visRatioRamp: { lo: 0.4, hi: 0.85 }, // fraction of frames usable: score 0 at lo, 1 at hi
  durationRampMs: { lo: 3000, hi: 8000 }, // ms of data span: score 0 at lo, 1 at hi
} as const

const C = ARMS_CONFIG
const MIN_LANDMARKS = 17 // need indices up to 16 (right wrist)

interface Arm {
  shoulder: number
  elbow: number
  wrist: number
}
// Subject-left arm = landmarks 11/13/15 unless swapLeftRight is set.
const ARM_LEFT: Arm = { shoulder: POSE.shoulderL, elbow: POSE.elbowL, wrist: POSE.wristL }
const ARM_RIGHT: Arm = { shoulder: POSE.shoulderR, elbow: POSE.elbowR, wrist: POSE.wristR }

export interface ArmsOptions {
  /** Video width / height (raw frame). Needed to get true angles from normalized landmarks. */
  aspectRatio?: number
}

const inFrame = (p: Landmark): boolean =>
  (p.visibility ?? 1) >= FRAMING_LIMITS.minVisibility &&
  p.x > FRAMING_LIMITS.edgeMargin &&
  p.x < 1 - FRAMING_LIMITS.edgeMargin &&
  p.y > FRAMING_LIMITS.edgeMargin &&
  p.y < 1 - FRAMING_LIMITS.edgeMargin

const finiteLm = (p: Landmark | undefined): p is Landmark => !!p && Number.isFinite(p.x) && Number.isFinite(p.y)

const r3 = (x: number): number => Math.round(x * 1000) / 1000

/** 5-frame (configurable) centred median over valid samples; NaN where the centre sample is invalid. */
function smooth(xs: number[]): number[] {
  const h = Math.floor(C.smoothWindow / 2)
  return xs.map((x, i) => {
    if (!Number.isFinite(x)) return NaN
    const w: number[] = []
    for (let j = Math.max(0, i - h); j <= Math.min(xs.length - 1, i + h); j++) if (Number.isFinite(xs[j])) w.push(xs[j])
    return median(w)
  })
}

/** Rolling median over +-sustainMs/2 of valid samples (needs >= 3 samples). NaN where too sparse. */
function sustained(ts: number[], xs: number[]): number[] {
  const half = C.sustainMs / 2
  return xs.map((x, i) => {
    if (!Number.isFinite(x)) return NaN
    const w: number[] = []
    for (let j = 0; j < xs.length; j++) if (Number.isFinite(xs[j]) && Math.abs(ts[j] - ts[i]) <= half) w.push(xs[j])
    return w.length >= 3 ? median(w) : NaN
  })
}

const finite = (xs: number[]): number[] => xs.filter((x) => Number.isFinite(x))

function retry(
  flag: string,
  base: { startedAt: number; durationMs: number },
  metrics: Record<string, number> = {},
  confidence = 0,
): TestResult {
  return {
    test: 'arms',
    severity: 0,
    confidence: clamp01(confidence),
    metrics,
    flags: [flag],
    startedAt: base.startedAt,
    durationMs: base.durationMs,
    needsRetry: true,
  }
}

const sideName = (isLeft: boolean): 'left' | 'right' => (isLeft ? 'left' : 'right')

/**
 * Arm-hold analysis. `frames` = the 10 s HOLD window only (framing gate + 3-2-1 cue already done by the caller).
 * Severity 0..1 (0 normal); `side` = patient's arm that drifted/failed. Bad/insufficient data => needsRetry.
 */
export function analyzeArms(frames: PoseFrame[], opts: ArmsOptions = {}): TestResult {
  const aspect = opts.aspectRatio && opts.aspectRatio > 0 ? opts.aspectRatio : C.defaultAspectRatio
  const [armL, armR] = C.swapLeftRight ? [ARM_RIGHT, ARM_LEFT] : [ARM_LEFT, ARM_RIGHT]

  const sorted = (Array.isArray(frames) ? frames : [])
    .filter((f) => f && Number.isFinite(f.t) && Array.isArray(f.landmarks))
    .sort((a, b) => a.t - b.t)
  if (sorted.length === 0) return retry('no pose frames', { startedAt: Date.now(), durationMs: 0 })

  const t0 = sorted[0].t
  const tEnd = sorted[sorted.length - 1].t
  const base = { startedAt: epochStartedAt(t0, tEnd - t0), durationMs: tEnd - t0 }
  const n = sorted.length

  // Per-frame extraction. A frame is usable only if all six joints are visible AND inside the frame and the shoulders
  // are wide enough (same conditions as the framing gate); anything else is ignored (NaN), never guessed.
  const ts = sorted.map((f) => f.t)
  const rawL = new Array<number>(n).fill(NaN)
  const rawR = new Array<number>(n).fill(NaN)
  const yDiff = new Array<number>(n).fill(NaN) // wristL.y - wristR.y over shoulder width (signed; + = left lower)
  const shoulderW: number[] = []
  let usable = 0

  sorted.forEach((f, i) => {
    const lm = f.landmarks
    if (lm.length < MIN_LANDMARKS) return
    const ids = [armL.shoulder, armL.elbow, armL.wrist, armR.shoulder, armR.elbow, armR.wrist]
    const pts = ids.map((id) => lm[id])
    if (!pts.every(finiteLm) || !pts.every(inFrame)) return
    const [sL, , wL, sR, , wR] = pts
    const sw = Math.abs(sL.x - sR.x)
    if (sw < FRAMING_LIMITS.shoulderWidthMin) return
    usable++
    shoulderW.push(sw)
    const theta = (s: Landmark, w: Landmark): number =>
      (Math.atan2(s.y - w.y, Math.abs(w.x - s.x) * aspect) * 180) / Math.PI
    rawL[i] = theta(sL, wL)
    rawR[i] = theta(sR, wR)
    yDiff[i] = (wL.y - wR.y) / (sw * aspect) // dy in height units / dx in height units
  })

  const visRatio = usable / n
  const spanMs = base.durationMs
  const baseMetrics = { frames: n, usable_frames: usable, vis_ratio: r3(visRatio), span_s: r3(spanMs / 1000) }

  // Data-sufficiency gates.
  if (spanMs < C.minDurationMs) {
    return retry('not enough data: need about 6 s of arm hold', base, baseMetrics)
  }
  if (usable < C.minValidFrames) {
    return retry('not enough usable frames: both arms and shoulders were not clearly visible', base, baseMetrics)
  }
  const visScore = ramp(visRatio, C.visRatioRamp.lo, C.visRatioRamp.hi)
  if (visScore < MIN_CONFIDENCE) {
    return retry("couldn't see both arms clearly: step back and keep both hands in view", base, baseMetrics, 0)
  }

  const thL = smooth(rawL)
  const thR = smooth(rawR)

  const edgeMedian = (th: number[], first: boolean): { m: number; count: number } => {
    const v = finite(th.filter((_, i) => (first ? ts[i] - t0 < C.edgeWindowMs : ts[i] > tEnd - C.edgeWindowMs)))
    return { m: median(v), count: v.length }
  }
  const startL = edgeMedian(thL, true)
  const startR = edgeMedian(thR, true)
  const endL = edgeMedian(thL, false)
  const endR = edgeMedian(thR, false)
  if (Math.min(startL.count, startR.count, endL.count, endR.count) < C.minWindowSamples) {
    return retry('arms not visible at the start or end of the hold: retry', base, baseMetrics, 0)
  }

  const driftL = startL.m - endL.m
  const driftR = startR.m - endR.m
  const driftAsym = Math.abs(driftL - driftR)

  const heightDiff = finite(yDiff.map(Math.abs)).reduce((a, b) => a + b, 0) / Math.max(1, usable)
  const lowerLeft = finite(yDiff).reduce((a, b) => a + b, 0) > 0 // mean signed diff > 0 => left wrist lower (larger y)

  const susL = sustained(ts, thL)
  const susR = sustained(ts, thR)
  const minThetaL = Math.min(...finite(susL))
  const minThetaR = Math.min(...finite(susR))
  const maxThetaL = Math.max(...finite(susL))
  const maxThetaR = Math.max(...finite(susR))
  if (![minThetaL, minThetaR, maxThetaL, maxThetaR].every(Number.isFinite)) {
    return retry('arm angle too noisy to measure: retry', base, baseMetrics, 0)
  }

  const neverRoseL = maxThetaL <= C.neverRoseDeg
  const neverRoseR = maxThetaR <= C.neverRoseDeg

  // Neither arm ever rose => the patient most likely did not do the test; ask again rather than call it a stroke sign.
  if (neverRoseL && neverRoseR) {
    return retry('neither arm was raised: retry and hold both arms straight out', base, { ...baseMetrics, min_theta_left: r3(minThetaL), min_theta_right: r3(minThetaR) }, 0)
  }

  // raised_time: seconds until theta first falls more than raisedWithinDeg below the starting theta (0 if it never rose).
  const raisedTime = (th: number[], start: number, neverRose: boolean): number => {
    if (neverRose) return 0
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(th[i]) && th[i] < start - C.raisedWithinDeg) return (ts[i] - t0) / 1000
    }
    return spanMs / 1000
  }
  const raisedL = raisedTime(thL, startL.m, neverRoseL)
  const raisedR = raisedTime(thR, startR.m, neverRoseR)

  // Severity.
  const W = C.weights
  const oneNeverRose = neverRoseL !== neverRoseR
  let severity = clamp01(
    W.driftAsym * ramp(driftAsym, C.driftAsymRamp.lo, C.driftAsymRamp.hi) +
      W.heightDiff * ramp(heightDiff, C.heightDiffRamp.lo, C.heightDiffRamp.hi) +
      W.neverRose * (oneNeverRose ? 1 : 0),
  )
  if (oneNeverRose) severity = Math.max(severity, C.severityFloorNeverRose)

  // Side + flags. Priority: an arm that never rose > larger drift (asymmetric) > lower wrist > both drifted equally.
  const flags: string[] = []
  let side: Side = 'none'
  if (oneNeverRose) {
    side = sideName(neverRoseL)
    flags.push(`${side} arm never rose`)
  } else if (driftAsym >= C.driftAsymRamp.lo) {
    side = sideName(driftL > driftR)
    flags.push(`${side} arm drifted down`)
  } else if (heightDiff >= C.heightDiffRamp.lo) {
    side = sideName(lowerLeft)
    flags.push(`${side} arm held lower`)
  } else if (Math.min(driftL, driftR) >= C.bothDriftMinDeg) {
    side = 'both'
  }
  if (Math.min(driftL, driftR) >= C.bothDriftMinDeg && driftAsym < C.driftAsymRamp.lo) {
    flags.push('both arms drifted equally')
  }
  if (!oneNeverRose) {
    if (minThetaL < C.droppedDeg && minThetaR >= C.droppedDeg) flags.push('left arm dropped')
    if (minThetaR < C.droppedDeg && minThetaL >= C.droppedDeg) flags.push('right arm dropped')
  }

  // Confidence.
  const durScore = ramp(spanMs, C.durationRampMs.lo, C.durationRampMs.hi)
  const confidence = clamp01(Math.min(visScore, durScore))

  const metrics: Record<string, number> = {
    ...baseMetrics,
    drift_left: r3(driftL),
    drift_right: r3(driftR),
    drift_asym: r3(driftAsym),
    height_diff: r3(heightDiff),
    min_theta_left: r3(minThetaL),
    min_theta_right: r3(minThetaR),
    raised_time_left: r3(raisedL),
    raised_time_right: r3(raisedR),
    shoulder_width: r3(median(shoulderW)),
    aspect_ratio: r3(aspect),
  }

  if (confidence < MIN_CONFIDENCE) {
    return {
      test: 'arms',
      severity: r3(severity),
      confidence: r3(confidence),
      metrics,
      flags: ['low confidence: arms partly out of view or too little data', ...flags],
      side,
      startedAt: base.startedAt,
      durationMs: base.durationMs,
      needsRetry: true,
    }
  }

  return {
    test: 'arms',
    severity: r3(severity),
    confidence: r3(confidence),
    metrics,
    flags,
    side,
    startedAt: base.startedAt,
    durationMs: base.durationMs,
  }
}
