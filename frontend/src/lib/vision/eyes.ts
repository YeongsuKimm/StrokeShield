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
import type { TestResult, Side } from '../contracts'
import { MIN_CONFIDENCE } from '../config'
import { clamp01, median, ramp } from '../math'
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
  /** Video frame width / height (landmarks are normalized per axis). Default 4/3. */
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
  maxYawDeg: 10, // deg: frames with |yaw| above this are REJECTED (not compensated)
  minFrames: 30, // frames: fewer total frames than this => needsRetry
  minSettledPerTarget: 8, // frames: clean, settled frames needed for EACH of center / left / right
  settleMs: 500, // ms: ignore at least this much of the start of every dot segment (saccade + transition + reaction)
  settleFraction: 0.5, // fraction of the segment duration to skip; so 2 s left/right segments are measured over their last 1 s
  minEyeWidth: 0.015, // fraction of frame width: corner-to-corner eye width below this makes a frame unusable
  ratioRange: [-0.3, 1.3] as const, // raw gaze ratio outside this = landmark glitch, frame dropped
  // --- metrics ---
  minMovement: 0.03, // eye widths: best-side excursion below this => gaze never followed the dot => needsRetry
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
  // --- confidence = min over components; each is a 0..1 ramp between lo (bad) and hi (good) ---
  confidence: {
    usableFrac: { lo: 0.4, hi: 0.8 }, // fraction of frames with iris present AND |yaw| ok
    yawStdDeg: { lo: 3, hi: 8 }, // deg: yaw std-dev over the run (head moving); higher lowers confidence
    settledFrames: { lo: 4, hi: 15 }, // frames: min settled frames over the three targets
    movement: { lo: 0.03, hi: 0.06 }, // eye widths: best-side excursion
    faceWidth: { lo: 0.1, hi: 0.18 }, // fraction of frame width
    noise: { lo: 0.02, hi: 0.06 }, // eye widths: within-segment gaze jitter; higher lowers confidence
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
  settled: boolean
}

const isPt = (p: { x: number; y: number } | undefined): p is { x: number; y: number } =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y)

/** Roll-corrected gaze for one frame, or null if landmarks are missing/implausible. */
function extractGaze(face: FaceFrame, aspect: number): Gaze | null {
  const lm = face.landmarks
  if (!Array.isArray(lm) || lm.length < IDX.minLandmarks) return null
  const pts = [IDX.rOuter, IDX.rInner, IDX.rIris, IDX.lOuter, IDX.lInner, IDX.lIris].map((i) => lm[i])
  if (!pts.every(isPt)) return null
  const [rO, rI, rIris, lO, lI, lIris] = pts.map((p) => ({ x: p.x * aspect, y: p.y })) // pixel space (height = 1)

  // Roll axis: outer corner of the right eye -> outer corner of the left eye (image +x when upright).
  let ux = lO.x - rO.x
  let uy = lO.y - rO.y
  const len = Math.hypot(ux, uy)
  if (len < 1e-3) return null
  ux /= len
  uy /= len
  const proj = (a: { x: number; y: number }, b: { x: number; y: number }) => (b.x - a.x) * ux + (b.y - a.y) * uy

  const wR = proj(rO, rI) // > 0
  const wL = proj(lO, lI) // < 0
  const minW = C.minEyeWidth * aspect
  if (!(wR > minW) || !(wL < -minW)) return null

  const ratioR = proj(rO, rIris) / wR
  const ratioL = proj(lO, lIris) / wL
  const [lo, hi] = C.ratioRange
  if (!(ratioR >= lo && ratioR <= hi && ratioL >= lo && ratioL <= hi)) return null

  let minX = Infinity
  let maxX = -Infinity
  for (const p of lm) {
    if (!isPt(p)) continue
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
  }
  return { gR: ratioR, gL: 1 - ratioL, faceW: maxX - minX }
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

interface Retry {
  metrics: Record<string, number>
  flags: string[]
  confidence: number
}

/**
 * Analyse a gaze-following run. `frames` in time order, each labelled with the dot's target (patient left/right).
 * Never throws; low quality or "gaze never moved" returns `needsRetry: true` with an explanatory flag.
 */
export function analyzeEyes(frames: EyeFrame[], opts: EyesOptions = {}): TestResult {
  const aspect = opts.aspect && opts.aspect > 0 ? opts.aspect : 4 / 3
  const list = Array.isArray(frames) ? frames.filter((f) => f && f.face) : []
  const startedAt = opts.startedAt ?? Date.now()
  const durationMs = list.length > 1 ? Math.max(0, list[list.length - 1].face.t - list[0].face.t) : 0
  const cc = C.confidence

  const retry = ({ metrics, flags, confidence }: Retry): TestResult => ({
    test: 'eyes',
    severity: 0,
    confidence: Math.min(MIN_CONFIDENCE * 0.9, clamp01(confidence)), // always below the shared cutoff
    metrics: finite(metrics),
    flags,
    side: 'none',
    startedAt,
    durationMs,
    needsRetry: true,
  })

  if (list.length < C.minFrames) {
    return retry({
      metrics: { frames: list.length },
      flags: [`too few frames (${list.length} of ${C.minFrames} needed)`],
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
  let noIris = 0
  let yawRejected = 0
  const yaws: number[] = []
  list.forEach((f, i) => {
    const yaw = f.face.yawDeg
    if (typeof yaw === 'number' && Number.isFinite(yaw)) yaws.push(yaw)
    const g = extractGaze(f.face, aspect)
    if (!g) {
      noIris++
      return
    }
    if (typeof yaw === 'number' && Number.isFinite(yaw) && Math.abs(yaw) > C.maxYawDeg) {
      yawRejected++
      return
    }
    // "Settled" = past the settle time AND in the later part of the segment, so a slow follower's plateau is measured.
    const sIdx = segOf[i]
    const since = f.face.t - segStartT[sIdx]
    const settleAfter = Math.max(C.settleMs, C.settleFraction * (segEndT[sIdx] - segStartT[sIdx]))
    samples.push({ ...g, t: f.face.t, seg: sIdx, settled: since >= settleAfter })
  })

  const n = list.length
  const usableFrac = samples.length / n
  const yawStd = std(yaws)
  const baseMetrics: Record<string, number> = {
    frames: n,
    usable_frames: samples.length,
    usable_frac: usableFrac,
    yaw_std_deg: yawStd,
  }

  const qualityFlags: string[] = []
  if (noIris > 0.3 * n) qualityFlags.push('iris landmarks missing in many frames')
  if (yawRejected > 0.3 * n) qualityFlags.push(`head turned more than ${C.maxYawDeg} degrees in many frames`)

  const settledOf = (target: EyeTarget) => samples.filter((s) => s.settled && segTarget[s.seg] === target)
  const centerS = settledOf('center')
  const leftS = settledOf('left')
  const rightS = settledOf('right')
  const minSettled = Math.min(centerS.length, leftS.length, rightS.length)
  baseMetrics.settled_center = centerS.length
  baseMetrics.settled_left = leftS.length
  baseMetrics.settled_right = rightS.length

  if (minSettled < C.minSettledPerTarget) {
    const missing = (['center', 'left', 'right'] as const).filter(
      (t) => settledOf(t).length < C.minSettledPerTarget,
    )
    return retry({
      metrics: baseMetrics,
      flags: [
        ...qualityFlags,
        `not enough clean frames while the dot was ${missing.join(' / ')}`,
      ],
      confidence: ramp(usableFrac, cc.usableFrac.lo, cc.usableFrac.hi),
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
  const eLeft = exc(leftS, 1)
  const eRight = exc(rightS, -1)
  const excLeft = (eLeft.r + eLeft.l) / 2
  const excRight = (eRight.r + eRight.l) / 2
  const maxExc = Math.max(excLeft, excRight)

  const rel = (a: number, b: number) => Math.abs(Math.max(0, a) - Math.max(0, b)) / Math.max(a, b, C.relFloor)
  const excursionAsym = rel(excLeft, excRight)
  const conjLeft = rel(eLeft.r, eLeft.l)
  const conjRight = rel(eRight.r, eRight.l)
  const conjugacyErr = Math.max(conjLeft, conjRight)
  const restDeviation = Math.abs(baseMean - 0.5)

  // Tracking lag: time from the dot move until the (smoothed) gaze crosses half of the eventual excursion.
  const lags: number[] = []
  for (const [target, sign, final] of [
    ['left', 1, excLeft],
    ['right', -1, excRight],
  ] as const) {
    if (final < C.minMovement) continue
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

  // Confidence: min over components.
  const segJitter: number[] = []
  for (let sIdx = 0; sIdx <= seg; sIdx++) {
    const a = samples.filter((x) => x.seg === sIdx && x.settled)
    if (a.length >= 4) segJitter.push((robustSigma(a.map((x) => x.gR)) + robustSigma(a.map((x) => x.gL))) / 2)
  }
  const noise = segJitter.length ? median(segJitter) : 0
  const faceW = median(samples.map((s) => s.faceW))
  const components = {
    usable: ramp(usableFrac, cc.usableFrac.lo, cc.usableFrac.hi),
    yawStable: 1 - ramp(yawStd, cc.yawStdDeg.lo, cc.yawStdDeg.hi),
    segments: ramp(minSettled, cc.settledFrames.lo, cc.settledFrames.hi),
    movement: ramp(maxExc, cc.movement.lo, cc.movement.hi),
    face: ramp(faceW, cc.faceWidth.lo, cc.faceWidth.hi),
    noise: 1 - ramp(noise, cc.noise.lo, cc.noise.hi),
  }
  const confidence = Math.min(...Object.values(components))

  const metrics: Record<string, number> = {
    ...baseMetrics,
    exc_left: excLeft,
    exc_right: excRight,
    exc_left_r_eye: eLeft.r, // patient's right eye when the dot was on the patient's left
    exc_left_l_eye: eLeft.l,
    exc_right_r_eye: eRight.r,
    exc_right_l_eye: eRight.l,
    excursion_asym: excursionAsym,
    conjugacy_err: conjugacyErr,
    conjugacy_err_left: conjLeft,
    conjugacy_err_right: conjRight,
    rest_deviation: restDeviation,
    rest_deviation_r_eye: Math.abs(baseR - 0.5),
    rest_deviation_l_eye: Math.abs(baseL - 0.5),
    baseline_r_eye: baseR,
    baseline_l_eye: baseL,
    gaze_noise: noise,
    face_width_frac: faceW,
    ...(Number.isFinite(trackingLag) ? { tracking_lag_s: trackingLag } : {}),
  }

  if (maxExc < C.minMovement) {
    const opposite = Math.min(excLeft, excRight) < -C.minMovement
    return retry({
      metrics: finite(metrics),
      flags: [
        ...qualityFlags,
        opposite ? 'gaze moved opposite to the dot; check left/right labeling' : 'gaze barely moved; dot not followed',
      ],
      confidence,
    })
  }
  if (confidence < MIN_CONFIDENCE) {
    const weakest = (Object.entries(components) as [string, number][]).sort((a, b) => a[1] - b[1])[0][0]
    return retry({
      metrics,
      flags: [...qualityFlags, `low-quality eye capture (weakest: ${weakest})`],
      confidence,
    })
  }

  const R = C.ramps
  const asymRamp = ramp(excursionAsym, R.excursionAsym.lo, R.excursionAsym.hi)
  const severity = clamp01(
    Math.max(
      C.weights.asym * asymRamp +
        C.weights.conj * ramp(conjugacyErr, R.conjugacyErr.lo, R.conjugacyErr.hi) +
        C.weights.rest * ramp(restDeviation, R.restDeviation.lo, R.restDeviation.hi),
      C.asymSaturates * asymRamp,
    ),
  )

  const flags = [...qualityFlags]
  let side: Side = 'none'
  if (excursionAsym >= C.sideAsymMin) {
    side = excLeft < excRight ? 'left' : 'right'
    flags.push(`gaze does not reach the ${side}`)
  }
  if (conjugacyErr >= R.conjugacyErr.lo) flags.push('eyes move unequally (one eye lagging)')
  if (restDeviation >= R.restDeviation.lo) flags.push('gaze rests off center')
  if (Number.isFinite(trackingLag) && trackingLag > C.lag.slowS) flags.push('slow to follow the dot')
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
