// Eyes test (BE-FAST stretch): gaze-following metrics. PURE: plain arrays in, TestResult out. No DOM/network/globals.
// Spec: docs/spec/02-vision.md "Eyes test". FEATURES.eyesTest stays false until this is verified live.
//
// LEFT/RIGHT MAPPING (read before touching anything)
// - "left"/"right" everywhere in this file mean the PATIENT's own left/right.
// - MediaPipe Face Landmarker names eyes from the SUBJECT's perspective (its own FACEMESH_LEFT_EYE / RIGHT_EYE
//   constants: left eye = 263 outer, 362 inner, iris 473 (474-477 ring); right eye = 33 outer, 133 inner, iris 468
//   (469-472 ring)). Blog posts that call 33/133 the "left eye" are naming from the viewer's side; ignore them.
//   Status: VERIFIED against MediaPipe's source constants/docs, NOT yet against a live camera. Confirm with the debug
//   overlay (draw 468 + 33 in one color, 473 + 263 in another; raise your right hand / cover your right eye).
// - In a RAW (unmirrored) camera frame the subject's left appears on the image RIGHT (larger x). So image +x =
//   patient-left. 33 (patient's right eye outer corner) therefore has the SMALLER x, 263 the larger x.
// - The spec's per-eye ratio (iris.x - outer.x) / (inner.x - outer.x) grows toward the NOSE (adduction) for both eyes.
//   We convert it to a common signed "leftward gaze" g so both eyes point the same way:
//     right eye (33/133/468):  g = ratio           (inner is at larger x, so g grows as the iris moves +x = left)
//     left eye  (263/362/473): g = 1 - ratio       (inner is at smaller x, so the ratio grows toward the right)
//   g ~ 0.5 means centered; g > 0.5 means looking to the patient's left; g < 0.5 looks right.
// - Landmarks are normalized per axis (x by width, y by height). Roll correction must happen in pixel space, so
//   `analyzeEyes` takes the frame aspect ratio (width/height, default 4/3) in `opts`. A wrong aspect only degrades roll
//   invariance slightly (proportional to the roll angle).
// - The dot is shown on the patient's screen. The patient faces the screen, so patient-left is physical screen-left.
//   If the UI renders the dot inside a CSS-mirrored (scaleX(-1)) container, the dot's CSS side is swapped. `target`
//   in EyeFrame must always be given in the PATIENT's own left/right, i.e. where the patient physically had to look.
//
// OUTCOMES (never a dead end; see docs/spec/02 "Eyes test"):
//  - TECHNICAL failure (the camera could not read the eyes: no face, dark, glare/jitter, head turned, too few frames):
//    `needsRetry: true`, flags[0] = an actionable phrase from eyeAdvice.ts. Frames are DROPPED (dropouts, blinks, turned
//    head, landmark glitches), never fatal on their own: a side or the whole run is scored on whatever settled frames
//    remain ("partial protocol"), with lower confidence.
//  - BEHAVIORAL (the eyes were tracked fine but did not follow the dot): a COMPLETED result (no needsRetry) with a
//    moderate severity and plain flags ("eyes did not follow the dot to the left"); confidence = how well the camera saw
//    the eyes. Inability to complete the task is a signal, not a crash. Still non-diagnostic and weight-capped (0.3).
import { epochStartedAt } from './time'
import type { TestResult, Side } from '../contracts'
import { MIN_CONFIDENCE } from '../config'
import { clamp01, median, ramp } from '../math'
import { EYE_MSG, type EyeCause } from './eyeAdvice'
import type { EyeTarget } from './eyeProtocol'
import type { FaceFrame } from './landmarks'

export type { EyeTarget } from './eyeProtocol'

/**
 * One analysed frame. `target` = which side the on-screen dot was on at this frame, in the PATIENT's own left/right
 * (NOT the screen's or the mirrored preview's). Label it at the moment the dot was commanded to move.
 */
export interface EyeFrame {
  face: FaceFrame
  target: EyeTarget
}

export interface EyesOptions {
  /** Video frame width / height (landmarks are normalized per axis). Default 16/9 (same as face/arms). */
  aspect?: number
  /** Epoch ms for TestResult.startedAt. Defaults to Date.now() (the only impure line, injectable for tests). */
  startedAt?: number
}

// ALL VALUES UNCALIBRATED. Gaze units are "fractions of eye width" (corner to corner). Typical numbers we reasoned
// from (not measured): a dot ~13-20 degrees off-center moves a real iris ~0.08-0.15 eye widths; iris-landmark webcam
// noise is ~0.01-0.02 eye widths. Tune on teammate recordings (docs/spec/05) before enabling the feature.
// Severity anchors (coordinator convention): healthy <= 0.15, borderline ~0.3-0.4, clear one-sided deficit >= 0.85.
// The retry cutoff is the shared MIN_CONFIDENCE from config.ts (not defined here).
export const EYES_CONFIG = {
  // --- frame gating ---
  maxYawDeg: 15, // deg: frames with |yaw| above this are REJECTED (not compensated). Was 10; equal to the face test's full-score yaw
  minFrames: 20, // frames: fewer total frames than this => needsRetry (was 30; a 7 s run at 10-30 fps has 70-210)
  minSettledPerTarget: 6, // frames: clean, settled frames needed to score center / a side (was 8)
  settleMs: 500, // ms: ignore at least this much of the start of every dot segment (saccade + transition + reaction)
  settleFraction: 0.5, // fraction of the segment duration to skip; so 2 s left/right segments are measured over their last 1 s
  // If the strict settle window leaves fewer than minSettledPerTarget frames for a target (slow camera / dropouts) the
  // window is relaxed to "everything after settleMs" so a sparse but real segment can still be scored.
  minEyeWidth: 0.015, // fraction of frame width: corner-to-corner eye width below this makes a frame unusable
  ratioRange: [-0.3, 1.3] as const, // raw gaze ratio outside this = landmark glitch, frame dropped
  blinkMax: 0.6, // eyeBlinkLeft/Right blendshape (0..1): a frame at/above this on either eye is a blink and is ignored
  minBrightness: 35, // mean luma 0..255: used ONLY to name "too dark" as the cause of a failed run
  outlier: { sigmas: 4, floor: 0.06 }, // settled samples further than max(sigmas * robust sigma, floor) eye widths from their target's median are dropped
  // --- attribution of a technical failure (which message to show) ---
  lostFrac: 0.3, // fraction of frames with no face/iris, or unusable geometry, that makes "lost your eyes" the cause
  headTurnedFrac: 0.3, // fraction of frames rejected for yaw that makes "head moved" the cause
  sideYawFrac: 0.5, // a side with no measurable frames where at least this fraction was rejected for yaw = head turned, not a dropout
  // --- metrics ---
  minMovement: 0.03, // eye widths: best-side excursion below this => gaze never followed the dot (BEHAVIORAL result, not a retry)
  relFloor: 0.05, // eye widths: denominator floor for relative asym/conjugacy (about half a normal excursion)
  lag: {
    fraction: 0.5, // fraction of the eventual excursion that counts as "gaze has arrived"
    minConsecutive: 2, // frames the gaze must stay past that fraction
    slowS: 1.2, // s: only raises a flag; tracking lag is NOT part of severity
  },
  // --- severity = max(weighted sum, asymSaturates * ramp(asym)) ---
  // Weights are the spec's (0.5/0.3/0.2). The max() term is a DEVIATION from the spec so that a clear one-sided gaze
  // deficit alone reaches >= 0.85 (the spec's sum would cap that case at 0.5 + rest term).
  weights: { asym: 0.5, conj: 0.3, rest: 0.2 }, // unitless, sum to 1
  asymSaturates: 0.9, // unitless: severity floor when excursion_asym ramp = 1
  ramps: {
    excursionAsym: { lo: 0.3, hi: 0.8 }, // unitless ratio; natural L/R amplitude difference is ~0.1-0.3
    conjugacyErr: { lo: 0.3, hi: 0.8 }, // unitless ratio; adduction vs abduction differences + noise
    restDeviation: { lo: 0.08, hi: 0.22 }, // eye widths: |mean baseline gaze - 0.5|
  },
  sideAsymMin: 0.4, // unitless: report `side` only when excursion_asym is at least this
  // --- behavioral / partial outcomes (completed results, never a retry) ---
  notFollowSeverity: 0.5, // eyes tracked fine but did not follow the dot: moderate (above borderline 0.35, below clear 0.85)
  partialConfidenceCap: 0.45, // only ONE side could be measured: never more confident than this (asymmetry unknown)
  // --- confidence = min over components; each is a 0..1 ramp between lo (bad) and hi (good) ---
  confidence: {
    usableFrac: { lo: 0.25, hi: 0.7 }, // fraction of non-blink frames with iris present AND |yaw| ok (was 0.4 / 0.8)
    yawStdDeg: { lo: 4, hi: 10 }, // deg: yaw std-dev over the run (head moving); higher lowers confidence (was 3 / 8)
    settledFrames: { lo: 3, hi: 12 }, // frames: min settled frames over the measured targets (was 4 / 15)
    movement: { lo: 0.03, hi: 0.06 }, // eye widths: best-side excursion
    faceWidth: { lo: 0.12, hi: 0.2 }, // fraction of frame width (landmarks 234/454); same scale as FACE_CONFIG
    noise: { lo: 0.025, hi: 0.07 }, // eye widths: within-segment gaze jitter; higher lowers confidence (was 0.02 / 0.06)
  },
}

const IDX = {
  rOuter: 33,
  rInner: 133,
  rIris: 468, // subject's RIGHT eye (image left in a raw frame)
  lOuter: 263,
  lInner: 362,
  lIris: 473, // subject's LEFT eye (image right in a raw frame)
  minLandmarks: 478,
} as const

const C = EYES_CONFIG

interface Gaze {
  gR: number // signed leftward gaze of the patient's RIGHT eye (0.5 = centered, > 0.5 = looking patient-left)
  gL: number // same for the patient's LEFT eye
  faceW: number // face width as fraction of frame width
}

interface Sample extends Gaze {
  t: number
  seg: number
  since: number // ms since the segment (dot position) started
  segMs: number // duration of the segment
}

const isPt = (p: { x: number; y: number } | undefined): p is { x: number; y: number } =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y)

type GazeResult = { gaze: Gaze } | { fail: 'no-face' | 'no-iris' | 'geometry' }

/** Roll-corrected gaze for one frame, or the reason it cannot be used. */
function extractGaze(face: FaceFrame, aspect: number): GazeResult {
  const lm = face.landmarks
  if (!Array.isArray(lm) || lm.length === 0) return { fail: 'no-face' }
  if (lm.length < IDX.minLandmarks) return { fail: 'no-iris' }
  const pts = [IDX.rOuter, IDX.rInner, IDX.rIris, IDX.lOuter, IDX.lInner, IDX.lIris].map((i) => lm[i])
  if (!pts.every(isPt)) return { fail: 'geometry' }
  const [rO, rI, rIris, lO, lI, lIris] = pts.map((p) => ({ x: p.x * aspect, y: p.y })) // pixel space (height = 1)

  // Roll axis: outer corner of the right eye -> outer corner of the left eye (image +x when upright).
  let ux = lO.x - rO.x
  let uy = lO.y - rO.y
  const len = Math.hypot(ux, uy)
  if (len < 1e-3) return { fail: 'geometry' }
  ux /= len
  uy /= len
  const proj = (a: { x: number; y: number }, b: { x: number; y: number }) => (b.x - a.x) * ux + (b.y - a.y) * uy

  const wR = proj(rO, rI) // > 0
  const wL = proj(lO, lI) // < 0
  const minW = C.minEyeWidth * aspect
  if (!(wR > minW) || !(wL < -minW)) return { fail: 'geometry' }

  const ratioR = proj(rO, rIris) / wR
  const ratioL = proj(lO, lIris) / wL
  const [lo, hi] = C.ratioRange
  if (!(ratioR >= lo && ratioR <= hi && ratioL >= lo && ratioL <= hi)) return { fail: 'geometry' }

  let minX = Infinity
  let maxX = -Infinity
  for (const p of lm) {
    if (!isPt(p)) continue
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
  }
  return { gaze: { gR: ratioR, gL: 1 - ratioL, faceW: maxX - minX } }
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN)
const std = (xs: number[]): number => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}
const robustSigma = (xs: number[]): number => {
  const m = median(xs)
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)))
}
const smooth3 = (xs: number[]): number[] =>
  xs.map((_, i) => median(xs.slice(Math.max(0, i - 1), Math.min(xs.length, i + 2))))

const finite = (m: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(m).filter(([, v]) => Number.isFinite(v)))

/** Drop settled samples that are wild relative to the target's own median (a glitching iris landmark, a half blink). */
function dropOutliers(arr: Sample[]): Sample[] {
  if (arr.length < C.minSettledPerTarget + 2) return arr
  const mR = median(arr.map((s) => s.gR))
  const mL = median(arr.map((s) => s.gL))
  const thrR = Math.max(C.outlier.sigmas * robustSigma(arr.map((s) => s.gR)), C.outlier.floor)
  const thrL = Math.max(C.outlier.sigmas * robustSigma(arr.map((s) => s.gL)), C.outlier.floor)
  const kept = arr.filter((s) => Math.abs(s.gR - mR) <= thrR && Math.abs(s.gL - mL) <= thrL)
  return kept.length >= C.minSettledPerTarget ? kept : arr
}

interface Counts {
  n: number // all frames
  blink: number
  noFace: number
  noIris: number
  geometry: number
  yaw: number
  usable: number
  darkFrac: number // 1 when the median brightness is below minBrightness, else 0 (NaN-free; brightness may be unknown)
}

/** Which technical cause best explains a failed run. */
function causeFromCounts(k: Counts): EyeCause {
  if (k.darkFrac > 0) return 'dark'
  const eff = Math.max(1, k.n - k.blink)
  const lost = (k.noFace + k.noIris + k.geometry) / eff
  const turned = k.yaw / eff
  if (turned >= C.headTurnedFrac && k.yaw >= k.noFace + k.noIris + k.geometry) return 'headTurned'
  if (lost >= C.lostFrac) return k.geometry > k.noFace + k.noIris ? 'glare' : 'lostEyes'
  if (turned >= C.headTurnedFrac) return 'headTurned'
  return 'lostEyes'
}

/** Cause for a weak confidence component when the frame counts do not already explain the failure. */
function causeFromComponent(weakest: string, k: Counts): EyeCause {
  switch (weakest) {
    case 'yawStable':
      return 'headTurned'
    case 'noise':
      return 'glare'
    case 'face':
      return 'tooFar'
    default:
      return causeFromCounts(k)
  }
}

interface Retry {
  metrics: Record<string, number>
  cause: EyeCause
  details?: string[]
  confidence: number
}

/**
 * Analyse a gaze-following run. `frames` in time order, each labelled with the dot's target (patient left/right).
 * Never throws. Returns a retry only for TECHNICAL failures (flags[0] says what to fix); an eye that tracked fine but did
 * not follow the dot is a completed result with a moderate severity (see the header).
 */
export function analyzeEyes(frames: EyeFrame[], opts: EyesOptions = {}): TestResult {
  const aspect = opts.aspect && opts.aspect > 0 ? opts.aspect : 16 / 9
  const list = Array.isArray(frames) ? frames.filter((f) => f && f.face) : []
  const durationMs = list.length > 1 ? Math.max(0, list[list.length - 1].face.t - list[0].face.t) : 0
  const startedAt = opts.startedAt ?? epochStartedAt(list[0]?.face.t, durationMs)
  const cc = C.confidence

  const retry = ({ metrics, cause, details = [], confidence }: Retry): TestResult => ({
    test: 'eyes',
    severity: 0,
    confidence: Math.min(MIN_CONFIDENCE * 0.9, clamp01(confidence)), // always below the shared cutoff
    metrics: finite(metrics),
    flags: [EYE_MSG[cause], ...details],
    side: 'none',
    startedAt,
    durationMs,
    needsRetry: true,
  })

  if (list.length < C.minFrames) {
    return retry({
      metrics: { frames: list.length },
      cause: 'lostEyes',
      details: [`too few frames (${list.length} of ${C.minFrames} needed)`],
      confidence: 0,
    })
  }

  // Segment by contiguous target runs (using ALL frames, so rejected frames don't shift the change time).
  const samples: Sample[] = []
  const segTarget: EyeTarget[] = []
  const segStartT: number[] = []
  const segEndT: number[] = [] // start of the next run (or last frame) = when the dot left this segment
  const segOf: number[] = []
  list.forEach((f, i) => {
    if (i === 0 || f.target !== list[i - 1].target) {
      if (i > 0) segEndT.push(f.face.t)
      segTarget.push(f.target)
      segStartT.push(f.face.t)
    }
    segOf.push(segTarget.length - 1)
  })
  segEndT.push(list[list.length - 1].face.t)
  const seg = segTarget.length - 1

  const k: Counts = { n: list.length, blink: 0, noFace: 0, noIris: 0, geometry: 0, yaw: 0, usable: 0, darkFrac: 0 }
  const yawByTarget: Record<EyeTarget, number> = { center: 0, left: 0, right: 0 }
  const framesByTarget: Record<EyeTarget, number> = { center: 0, left: 0, right: 0 }
  const yaws: number[] = []
  const brights: number[] = []
  list.forEach((f, i) => {
    framesByTarget[f.target]++
    const yaw = f.face.yawDeg
    if (typeof yaw === 'number' && Number.isFinite(yaw)) yaws.push(yaw)
    const bright = (f.face as { brightness?: number }).brightness
    if (typeof bright === 'number' && Number.isFinite(bright)) brights.push(bright)
    const bs = f.face.blendshapes ?? {}
    if (Math.max(bs.eyeBlinkLeft ?? 0, bs.eyeBlinkRight ?? 0) >= C.blinkMax) {
      k.blink++ // a blink is normal, not a tracking problem: ignored, and not counted against the usable fraction
      return
    }
    const g = extractGaze(f.face, aspect)
    if ('fail' in g) {
      if (g.fail === 'no-face') k.noFace++
      else if (g.fail === 'no-iris') k.noIris++
      else k.geometry++
      return
    }
    if (typeof yaw === 'number' && Number.isFinite(yaw) && Math.abs(yaw) > C.maxYawDeg) {
      k.yaw++
      yawByTarget[f.target]++
      return
    }
    const sIdx = segOf[i]
    samples.push({ ...g.gaze, t: f.face.t, seg: sIdx, since: f.face.t - segStartT[sIdx], segMs: segEndT[sIdx] - segStartT[sIdx] })
  })
  k.usable = samples.length
  if (brights.length && median(brights) < C.minBrightness) k.darkFrac = 1

  const nEff = Math.max(1, k.n - k.blink)
  const usableFrac = samples.length / nEff
  const yawStd = std(yaws)
  const baseMetrics: Record<string, number> = {
    frames: k.n,
    usable_frames: samples.length,
    usable_frac: usableFrac,
    yaw_std_deg: yawStd,
    frames_blink: k.blink,
    frames_no_face: k.noFace + k.noIris,
    frames_bad_geometry: k.geometry,
    frames_head_turned: k.yaw,
  }

  const details: string[] = []
  if ((k.noFace + k.noIris) > 0.3 * nEff) details.push('iris landmarks missing in many frames')
  if (k.yaw > 0.3 * nEff) details.push(`head turned more than ${C.maxYawDeg} degrees in many frames`)
  if (k.darkFrac > 0) details.push('image is very dark')

  // Settled frames per target: strict window first, relaxed (just past settleMs) when that leaves too few.
  const strict = (s: Sample) => s.since >= Math.max(C.settleMs, C.settleFraction * s.segMs)
  const relaxedOk = (s: Sample) => s.since >= C.settleMs
  const settledOf = (target: EyeTarget): Sample[] => {
    const own = samples.filter((s) => segTarget[s.seg] === target)
    const strictSet = own.filter(strict)
    const chosen = strictSet.length >= C.minSettledPerTarget ? strictSet : own.filter(relaxedOk)
    return dropOutliers(chosen)
  }
  const centerS = settledOf('center')
  const leftS = settledOf('left')
  const rightS = settledOf('right')
  const min = C.minSettledPerTarget
  const haveCenter = centerS.length >= min
  const haveLeft = leftS.length >= min
  const haveRight = rightS.length >= min
  baseMetrics.settled_center = centerS.length
  baseMetrics.settled_left = leftS.length
  baseMetrics.settled_right = rightS.length
  const usableConf = ramp(usableFrac, cc.usableFrac.lo, cc.usableFrac.hi)

  // A side that has frames but lost most of them to a turned head is the patient turning their head to look, not a
  // camera dropout: ask for a still head rather than scoring around it.
  const turnedSide = (['left', 'right'] as const).some(
    (t) => !(t === 'left' ? haveLeft : haveRight) && framesByTarget[t] > 0 && yawByTarget[t] >= C.sideYawFrac * framesByTarget[t],
  )

  if (!haveCenter || (!haveLeft && !haveRight) || turnedSide) {
    const missing = (['center', 'left', 'right'] as const).filter((t) => !(t === 'center' ? haveCenter : t === 'left' ? haveLeft : haveRight))
    return retry({
      metrics: baseMetrics,
      cause: turnedSide ? 'headTurned' : causeFromCounts(k),
      details: [...details, `not enough clean frames while the dot was ${missing.join(' / ')}`],
      confidence: usableConf,
    })
  }

  // Baseline (dot centered), per eye.
  const baseR = median(centerS.map((s) => s.gR))
  const baseL = median(centerS.map((s) => s.gL))
  const baseMean = (baseR + baseL) / 2

  // Excursion toward the target side (positive = the eye went the right way). Left is +g, right is -g.
  const exc = (arr: Sample[], sign: 1 | -1) => ({
    r: sign * (median(arr.map((s) => s.gR)) - baseR),
    l: sign * (median(arr.map((s) => s.gL)) - baseL),
  })
  const eLeft = haveLeft ? exc(leftS, 1) : { r: NaN, l: NaN }
  const eRight = haveRight ? exc(rightS, -1) : { r: NaN, l: NaN }
  const excLeft = haveLeft ? (eLeft.r + eLeft.l) / 2 : NaN
  const excRight = haveRight ? (eRight.r + eRight.l) / 2 : NaN
  const measured = [excLeft, excRight].filter(Number.isFinite)
  const maxExc = Math.max(...measured)
  const bothSides = haveLeft && haveRight
  const partialSide: 'left' | 'right' | null = bothSides ? null : haveLeft ? 'left' : 'right'

  const rel = (a: number, b: number) => Math.abs(Math.max(0, a) - Math.max(0, b)) / Math.max(a, b, C.relFloor)
  const excursionAsym = bothSides ? rel(excLeft, excRight) : 0
  const conjLeft = haveLeft ? rel(eLeft.r, eLeft.l) : 0
  const conjRight = haveRight ? rel(eRight.r, eRight.l) : 0
  const conjugacyErr = Math.max(conjLeft, conjRight)
  const restDeviation = Math.abs(baseMean - 0.5)

  // Tracking lag: time from the dot move until the (smoothed) gaze crosses half of the eventual excursion.
  const lags: number[] = []
  for (const [target, sign, final] of [
    ['left', 1, excLeft],
    ['right', -1, excRight],
  ] as const) {
    if (!(final >= C.minMovement)) continue
    for (let sIdx = 0; sIdx < segTarget.length; sIdx++) {
      if (segTarget[sIdx] !== target) continue
      const inSeg = samples.filter((s) => s.seg === sIdx)
      const sig = smooth3(inSeg.map((s) => sign * ((s.gR + s.gL) / 2 - baseMean)))
      const need = C.lag.fraction * final
      for (let i = 0; i + C.lag.minConsecutive <= sig.length; i++) {
        if (sig.slice(i, i + C.lag.minConsecutive).every((v) => v >= need)) {
          lags.push((inSeg[i].t - segStartT[sIdx]) / 1000)
          break
        }
      }
    }
  }
  const trackingLag = lags.length ? mean(lags) : NaN

  // Confidence: min over components. `quality` is everything EXCEPT movement: it says how well the camera saw the eyes,
  // independent of whether they followed the dot (that is the behavioral question, answered below).
  const segJitter: number[] = []
  for (let sIdx = 0; sIdx <= seg; sIdx++) {
    const a = samples.filter((x) => x.seg === sIdx && strict(x))
    if (a.length >= 4) segJitter.push((robustSigma(a.map((x) => x.gR)) + robustSigma(a.map((x) => x.gL))) / 2)
  }
  const noise = segJitter.length ? median(segJitter) : 0
  const faceW = median(samples.map((s) => s.faceW))
  const minSettled = Math.min(...[centerS, haveLeft ? leftS : null, haveRight ? rightS : null].filter((a): a is Sample[] => !!a).map((a) => a.length))
  const quality = {
    usable: usableConf,
    yawStable: 1 - ramp(yawStd, cc.yawStdDeg.lo, cc.yawStdDeg.hi),
    segments: ramp(minSettled, cc.settledFrames.lo, cc.settledFrames.hi),
    face: ramp(faceW, cc.faceWidth.lo, cc.faceWidth.hi),
    noise: 1 - ramp(noise, cc.noise.lo, cc.noise.hi),
  }
  const qualityConf = Math.min(...Object.values(quality))
  const movementConf = ramp(maxExc, cc.movement.lo, cc.movement.hi)

  const metrics: Record<string, number> = {
    ...baseMetrics,
    exc_left: excLeft,
    exc_right: excRight,
    exc_left_r_eye: eLeft.r, // patient's right eye when the dot was on the patient's left
    exc_left_l_eye: eLeft.l,
    exc_right_r_eye: eRight.r,
    exc_right_l_eye: eRight.l,
    excursion_asym: bothSides ? excursionAsym : NaN,
    conjugacy_err: conjugacyErr,
    conjugacy_err_left: haveLeft ? conjLeft : NaN,
    conjugacy_err_right: haveRight ? conjRight : NaN,
    rest_deviation: restDeviation,
    rest_deviation_r_eye: Math.abs(baseR - 0.5),
    rest_deviation_l_eye: Math.abs(baseL - 0.5),
    baseline_r_eye: baseR,
    baseline_l_eye: baseL,
    gaze_noise: noise,
    face_width_frac: faceW,
    ...(Number.isFinite(trackingLag) ? { tracking_lag_s: trackingLag } : {}),
  }

  // TECHNICAL: the camera did not see the eyes well enough to say anything about them.
  if (qualityConf < MIN_CONFIDENCE) {
    const weakest = (Object.entries(quality) as [string, number][]).sort((a, b) => a[1] - b[1])[0][0]
    return retry({
      metrics,
      cause: causeFromComponent(weakest, k),
      details: [...details, `low-quality eye capture (weakest: ${weakest})`],
      confidence: qualityConf,
    })
  }

  // Gaze moved AGAINST the dot on every measured side: mislabelled sides or a patient looking the wrong way. Not scoreable.
  if (maxExc < C.minMovement && Math.min(...measured) < -C.minMovement) {
    return retry({
      metrics,
      cause: 'lookAtDot',
      details: [...details, 'gaze moved opposite to the dot; check left/right labeling'],
      confidence: qualityConf,
    })
  }

  const sideNames = { left: excLeft, right: excRight } as const
  const partialFlags = partialSide ? [`only the ${partialSide} side could be measured`] : []
  const cap = (c: number) => (partialSide ? Math.min(c, C.partialConfidenceCap) : c)

  // BEHAVIORAL: tracked fine, but the eyes did not follow the dot on any measured side. A real, completed, moderate
  // result. It is never a silent pass and never a dead end.
  if (movementConf < MIN_CONFIDENCE) {
    const flags = [...details]
    for (const s of ['left', 'right'] as const) {
      if (Number.isFinite(sideNames[s])) flags.push(`eyes did not follow the dot to the ${s}`)
    }
    flags.push(...partialFlags)
    return {
      test: 'eyes',
      severity: C.notFollowSeverity,
      confidence: cap(qualityConf),
      metrics: finite(metrics),
      flags,
      side: 'none',
      startedAt,
      durationMs,
    }
  }

  const confidence = cap(Math.min(qualityConf, movementConf))
  if (confidence < MIN_CONFIDENCE) {
    return retry({ metrics, cause: 'lostEyes', details: [...details, 'low-quality eye capture (weakest: movement)'], confidence })
  }

  const R = C.ramps
  const asymRamp = bothSides ? ramp(excursionAsym, R.excursionAsym.lo, R.excursionAsym.hi) : 0
  const severity = clamp01(
    Math.max(
      C.weights.asym * asymRamp +
        C.weights.conj * ramp(conjugacyErr, R.conjugacyErr.lo, R.conjugacyErr.hi) +
        C.weights.rest * ramp(restDeviation, R.restDeviation.lo, R.restDeviation.hi),
      C.asymSaturates * asymRamp,
    ),
  )

  const qualityFlags = [...details]
  const flags = [...qualityFlags]
  let side: Side = 'none'
  if (bothSides && excursionAsym >= C.sideAsymMin) {
    side = excLeft < excRight ? 'left' : 'right'
    flags.push(`gaze does not reach the ${side}`)
  }
  for (const s of ['left', 'right'] as const) {
    if (Number.isFinite(sideNames[s]) && sideNames[s] < C.minMovement) flags.push(`eyes did not follow the dot to the ${s}`)
  }
  if (conjugacyErr >= R.conjugacyErr.lo) flags.push('eyes move unequally (one eye lagging)')
  if (restDeviation >= R.restDeviation.lo) flags.push('gaze rests off center')
  if (Number.isFinite(trackingLag) && trackingLag > C.lag.slowS) flags.push('slow to follow the dot')
  flags.push(...partialFlags)
  if (flags.length === qualityFlags.length) flags.push('eyes followed the dot symmetrically')

  return {
    test: 'eyes',
    severity,
    confidence,
    metrics: finite(metrics),
    flags,
    side,
    startedAt,
    durationMs,
  }
}
