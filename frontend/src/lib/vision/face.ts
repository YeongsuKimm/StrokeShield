// OWNER: Vision dev. Spec: docs/spec/02-vision.md ("Face test"). PURE function: no DOM, no network, no globals.
//
// ---------------------------------------------------------------------------------------------------------------
// LEFT / RIGHT MAPPING  (status: ASSUMED, NOT yet verified on a live camera)
//
// All landmarks are RAW (unmirrored) image coordinates (the <video> is only mirrored by CSS for display).
// "patient's left/right" = the patient's own anatomical left/right.
//
//   Face Mesh landmarks (the canonical face model is annotated from the SUBJECT's point of view):
//     33  outer corner of the patient's RIGHT eye  -> appears on the image-LEFT  (small x) in a raw frame
//     263 outer corner of the patient's LEFT  eye  -> appears on the image-RIGHT (large x)
//     61  patient's RIGHT mouth corner (image-left);  291 patient's LEFT mouth corner (image-right)
//     159/145 upper/lower lid of the patient's RIGHT eye;  386/374 upper/lower lid of the patient's LEFT eye
//   The two facts "patient's right is at small x" (a person facing a camera) and "33/61 belong to the subject's
//   right" are consistent with the standard Face Mesh picture (33 is at image-left on an unmirrored frame). VERIFIED
//   by geometry/reading of the canonical mesh, NOT by running a camera: ASSUMED until the debug overlay confirms.
//
//   Blendshapes (mouthSmileLeft / mouthSmileRight, ...): ASSUMED to follow the ARKit convention, i.e.
//   "Left" = the patient's (subject's) left = the same side as landmark 291. The official docs do not spell this
//   out, and community reports suggest some MediaPipe outputs are image-relative (which would be swapped).
//   This only affects (a) the "smile_bs_asym" side agreement flag; the magnitude, and the reported `side`, come from
//   landmarks. Flip `FACE_CONFIG.blendshapeLeftIsPatientLeft` if the live check shows they are swapped.
//
// MUST BE CONFIRMED with the debug overlay on a live camera: raise only the patient's LEFT mouth corner and check
// that `side` / the landmark reading is what is documented above (and separately, that mouthSmileLeft rises).
// The tests in face.test.ts encode exactly this documented mapping.
// ---------------------------------------------------------------------------------------------------------------
import { epochStartedAt } from './time'
import { MIN_CONFIDENCE } from '../config'
import type { TestResult, Side } from '../contracts'
import { clamp01, median, ramp } from '../math'
import type { FaceFrame, Landmark } from './landmarks'

/**
 * All thresholds, ramps and weights for the face test. ALL VALUES ARE UNCALIBRATED until tuned on
 * teammate fixtures (see docs/spec/02-vision.md). Distances are in units of inter-ocular distance (IOD =
 * distance between the outer eye corners 33 and 263).
 */
export const FACE_CONFIG = {
  // --- capture sufficiency ---
  minNeutralFrames: 5, // frames with a detected face needed in the neutral capture
  minSmileFrames: 8, // ... and in the smile capture
  topFraction: 0.2, // fraction of smile frames used (best by mean smile blendshape); median taken over them
  minTopFrames: 3, // ... but never fewer than this many frames

  // --- smile quality gates (blendshape units 0..1) ---
  minSmilePeak: 0.3, // stronger side's smile blendshape must reach this. (Spec says mean; a mean gate would
  //                    reject a severe droop where one side is ~0. See note in the report.)
  minSmileMean: 0.15, // `smile_strength` (mean of both sides) floor
  maxNeutralSmile: 0.35, // neutral-capture smile above this = patient was already smiling -> retry

  // --- confidence components: each maps to 0..1, confidence = min of them; retry if < MIN_CONFIDENCE (config.ts) ---
  detectedFull: 0.9, // detected-frame ratio (0..1) at/above which the component is 1
  detectedZero: 0.4, // ... at/below which it is 0
  yawFullDeg: 15, // |yaw| in degrees at/below which the component is 1 (spec: within +-15)
  yawZeroDeg: 25, // |yaw| in degrees at/above which it is 0
  yawUnknownScore: 0.8, // component value when the runtime supplies no yaw
  faceWidthFull: 0.2, // face width / frame width at/above which the component is 1 (spec: >= 20 %)
  faceWidthZero: 0.12, // ... at/below which it is 0
  brightnessLowZero: 25, // mean luma 0..255 (optional input): at/below -> 0
  brightnessLowFull: 60, // at/above -> 1 (dark side)
  brightnessHighFull: 220, // at/below -> 1 (bright side)
  brightnessHighZero: 245, // at/above -> 0
  smilePeakFull: 0.5, // stronger-side smile blendshape at/above which the component is 1
  smilePeakZero: 0.15, // ... at/below which it is 0

  // --- metric definitions ---
  defaultAspect: 16 / 9, // frame width / height, used when the capture frame doesn't supply it
  epsLift: 0.03, // IOD units: floor of the lift_asym denominator
  epsBlendshape: 0.05, // blendshape units: floor of the smile_bs_asym denominator
  epsAperture: 0.02, // IOD units: floor of the eye_aperture_asym denominator

  // --- severity: weight * ramp(metric; lo = normal, hi = clearly abnormal). Weights sum to 1. ---
  // Anchors (see face.test.ts): natural mild asymmetry <= 0.15, borderline ~0.3-0.4, clear one-sided droop >= 0.85.
  ramps: {
    lift_asym: { lo: 0.15, hi: 0.5, weight: 0.45 }, // ratio 0..1: |liftL - liftR| / max(lift)
    smile_bs_asym: { lo: 0.2, hi: 0.6, weight: 0.25 }, // ratio 0..1: blendshape asymmetry
    corner_height_diff: { lo: 0.02, hi: 0.07, weight: 0.2 }, // IOD units: roll-corrected |yL - yR| in the smile
    eye_aperture_asym: { lo: 0.15, hi: 0.4, weight: 0.1 }, // ratio 0..1: lid-gap asymmetry (secondary)
  },

  // --- mapping (ASSUMED, see header) ---
  blendshapeLeftIsPatientLeft: true, // mouthSmileLeft is the patient's left (landmark 291 side)
} as const

/** Face Mesh indices used here. Names are the PATIENT's side (see header). */
const IDX = {
  eyeOuterR: 33, // patient's right eye outer corner (image-left in a raw frame)
  eyeOuterL: 263,
  mouthR: 61,
  mouthL: 291,
  lidTopR: 159,
  lidBotR: 145,
  lidTopL: 386,
  lidBotL: 374,
  faceSideR: 234, // face-width reference points (cheek/temple contour)
  faceSideL: 454,
} as const

const MIN_LANDMARKS = 468

/** A FaceFrame plus optional capture-side info the runtime may know. */
export interface FaceCaptureFrame extends FaceFrame {
  brightness?: number // mean luma of the video frame, 0..255
  aspect?: number // video width / height (landmarks are normalized per axis, so this is needed for true angles)
}

/** Per-frame features, all in roll-corrected, IOD-normalized face space (u right in image, v DOWN). */
interface FrameFeatures {
  t: number
  cornerVL: number // patient's left mouth corner, vertical position
  cornerVR: number
  apertureL: number
  apertureR: number
  smileL: number // patient's-left smile blendshape (after the assumed mapping)
  smileR: number
  smileMean: number
  yawDeg: number | undefined
  faceWidth: number // fraction of frame width
  brightness: number | undefined
}

const finite = (n: number): boolean => Number.isFinite(n)
const pointOk = (p: Landmark | undefined): p is Landmark => !!p && finite(p.x) && finite(p.y)

function extractFeatures(f: FaceCaptureFrame): FrameFeatures | null {
  const lm = f?.landmarks
  if (!Array.isArray(lm) || lm.length < MIN_LANDMARKS) return null
  const ids = Object.values(IDX)
  if (!ids.every((i) => pointOk(lm[i]))) return null

  const aspect = f.aspect && f.aspect > 0 ? f.aspect : FACE_CONFIG.defaultAspect
  // Work in "image-height units" so angles/distances are isotropic.
  const X = (i: number) => lm[i].x * aspect
  const Y = (i: number) => lm[i].y

  const dx = X(IDX.eyeOuterL) - X(IDX.eyeOuterR)
  const dy = Y(IDX.eyeOuterL) - Y(IDX.eyeOuterR)
  const iod = Math.hypot(dx, dy)
  // dx <= 0 means the eye line points the wrong way (mirrored / upside-down input): unusable.
  if (!(iod > 1e-3) || dx <= 0) return null
  const theta = Math.atan2(dy, dx)
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const mx = (X(IDX.eyeOuterR) + X(IDX.eyeOuterL)) / 2
  const my = (Y(IDX.eyeOuterR) + Y(IDX.eyeOuterL)) / 2
  // Rotate by -theta so the eye line is horizontal; origin at the eye midpoint (cancels translation).
  const v = (i: number) => (-(X(i) - mx) * sin + (Y(i) - my) * cos) / iod

  const bs = f.blendshapes ?? {}
  const bsLeft = bs.mouthSmileLeft ?? 0
  const bsRight = bs.mouthSmileRight ?? 0
  const [smileL, smileR] = FACE_CONFIG.blendshapeLeftIsPatientLeft ? [bsLeft, bsRight] : [bsRight, bsLeft]

  const out: FrameFeatures = {
    t: f.t,
    cornerVL: v(IDX.mouthL),
    cornerVR: v(IDX.mouthR),
    apertureL: Math.abs(v(IDX.lidTopL) - v(IDX.lidBotL)),
    apertureR: Math.abs(v(IDX.lidTopR) - v(IDX.lidBotR)),
    smileL,
    smileR,
    smileMean: (smileL + smileR) / 2,
    yawDeg: f.yawDeg !== undefined && finite(f.yawDeg) ? f.yawDeg : undefined,
    faceWidth: Math.hypot(X(IDX.faceSideL) - X(IDX.faceSideR), Y(IDX.faceSideL) - Y(IDX.faceSideR)) / aspect,
    brightness: f.brightness !== undefined && finite(f.brightness) ? f.brightness : undefined,
  }
  const nums = [out.cornerVL, out.cornerVR, out.apertureL, out.apertureR, out.smileL, out.smileR, out.faceWidth]
  return nums.every(finite) ? out : null
}

const medianOf = <T>(xs: T[], pick: (x: T) => number): number => median(xs.map(pick))

const defined = (xs: (number | undefined)[]): number[] => xs.filter((x): x is number => x !== undefined)

const ROUND = (x: number, d = 4): number => Math.round(x * 10 ** d) / 10 ** d

function timing(all: FaceCaptureFrame[]): { startedAt: number; durationMs: number } {
  const ts = all.map((f) => f?.t).filter((t): t is number => typeof t === 'number' && finite(t))
  if (ts.length === 0) return { startedAt: Date.now(), durationMs: 0 }
  const t0 = Math.min(...ts)
  const durationMs = Math.max(...ts) - t0
  // Frame `t` may be epoch ms or a performance.now()-style clock; only trust it as startedAt if epoch-like.
  const startedAt = epochStartedAt(t0, durationMs)
  return { startedAt, durationMs }
}

function retryResult(
  flags: string[],
  all: FaceCaptureFrame[],
  metrics: Record<string, number> = {},
  confidence = 0,
): TestResult {
  const { startedAt, durationMs } = timing(all)
  return {
    test: 'face',
    severity: 0,
    // Keep below MIN_CONFIDENCE so downstream scoring excludes it as "couldn't measure".
    confidence: Math.min(clamp01(confidence), MIN_CONFIDENCE * 0.99),
    metrics,
    flags,
    side: 'none',
    startedAt,
    durationMs,
    needsRetry: true,
  }
}

/**
 * Face droop analysis. `neutral` = ~1.5 s of "relax your face" frames, `smile` = ~3 s of "big smile, hold" frames.
 * Never throws; unusable input returns `needsRetry: true` with an explanatory flag.
 */
export function analyzeFace(neutral: FaceCaptureFrame[], smile: FaceCaptureFrame[]): TestResult {
  const C = FACE_CONFIG
  const neutralIn = Array.isArray(neutral) ? neutral : []
  const smileIn = Array.isArray(smile) ? smile : []
  const all = [...neutralIn, ...smileIn]

  const nFeat = neutralIn.map(extractFeatures).filter((x): x is FrameFeatures => x !== null)
  const sFeat = smileIn.map(extractFeatures).filter((x): x is FrameFeatures => x !== null)
  const detectedRatio = all.length ? (nFeat.length + sFeat.length) / all.length : 0

  if (nFeat.length < C.minNeutralFrames || sFeat.length < C.minSmileFrames) {
    const flag =
      all.length > 0 && nFeat.length + sFeat.length === 0
        ? 'face not detected (or landmarks mirrored)'
        : 'not enough frames with a detected face'
    return retryResult([flag], all, {}, ramp(detectedRatio, C.detectedZero, C.detectedFull))
  }

  // --- neutral baseline ---
  const nVL = medianOf(nFeat, (f) => f.cornerVL)
  const nVR = medianOf(nFeat, (f) => f.cornerVR)
  const neutralSmile = medianOf(nFeat, (f) => f.smileMean)

  // --- top 20 % smile frames by mean smile blendshape ---
  const ranked = [...sFeat].sort((a, b) => b.smileMean - a.smileMean)
  const topN = Math.min(ranked.length, Math.max(C.minTopFrames, Math.ceil(ranked.length * C.topFraction)))
  const top = ranked.slice(0, topN)

  const sVL = medianOf(top, (f) => f.cornerVL)
  const sVR = medianOf(top, (f) => f.cornerVR)
  const smileL = medianOf(top, (f) => f.smileL)
  const smileR = medianOf(top, (f) => f.smileR)
  const apL = medianOf(top, (f) => f.apertureL)
  const apR = medianOf(top, (f) => f.apertureR)

  // v points down, so a corner moving up has a smaller v: lift = neutral - smile.
  const liftL = nVL - sVL
  const liftR = nVR - sVR

  const liftAsym = Math.abs(liftL - liftR) / Math.max(liftL, liftR, C.epsLift)
  const bsAsym = Math.abs(smileL - smileR) / Math.max(smileL, smileR, C.epsBlendshape)
  const cornerHeightDiff = medianOf(top, (f) => Math.abs(f.cornerVL - f.cornerVR))
  const apertureAsym = Math.abs(apL - apR) / Math.max(apL, apR, C.epsAperture)
  const smileStrength = medianOf(top, (f) => f.smileMean)
  const smilePeak = Math.max(smileL, smileR)

  const metrics: Record<string, number> = {
    lift_asym: ROUND(liftAsym),
    smile_bs_asym: ROUND(bsAsym),
    corner_height_diff: ROUND(cornerHeightDiff),
    eye_aperture_asym: ROUND(apertureAsym),
    smile_strength: ROUND(smileStrength),
    smile_peak: ROUND(smilePeak),
    lift_left: ROUND(liftL),
    lift_right: ROUND(liftR),
  }

  // --- confidence: min of independent quality components ---
  const yaws = defined([...nFeat, ...top].map((f) => f.yawDeg)).map(Math.abs)
  const yawScore = yaws.length ? ramp(median(yaws), C.yawZeroDeg, C.yawFullDeg) : C.yawUnknownScore
  const widthScore = ramp(medianOf(top, (f) => f.faceWidth), C.faceWidthZero, C.faceWidthFull)
  const detectedScore = ramp(detectedRatio, C.detectedZero, C.detectedFull)
  const smileScore = ramp(smilePeak, C.smilePeakZero, C.smilePeakFull)
  const brights = defined([...nFeat, ...top].map((f) => f.brightness))
  const brightScore = brights.length
    ? Math.min(
        ramp(median(brights), C.brightnessLowZero, C.brightnessLowFull),
        ramp(median(brights), C.brightnessHighZero, C.brightnessHighFull),
      )
    : 1
  const confidence = Math.min(detectedScore, yawScore, widthScore, smileScore, brightScore)
  if (yaws.length) metrics.yaw_abs_deg = ROUND(median(yaws), 2)

  // --- retry conditions (never a confident guess) ---
  const retry: string[] = []
  if (smilePeak < C.minSmilePeak || smileStrength < C.minSmileMean) retry.push('smile not detected')
  if (neutralSmile > C.maxNeutralSmile) retry.push('already smiling during the relaxed capture')
  if (yawScore < MIN_CONFIDENCE) retry.push('head turned away from the camera')
  if (widthScore < MIN_CONFIDENCE) retry.push('face too small in frame')
  if (brightScore < MIN_CONFIDENCE) retry.push('lighting too dark or too bright')
  if (detectedScore < MIN_CONFIDENCE) retry.push('face not tracked in enough frames')
  if (retry.length === 0 && confidence < MIN_CONFIDENCE) retry.push('capture quality too low')
  if (retry.length) return retryResult(retry, all, metrics, confidence)

  // --- severity ---
  const R = C.ramps
  const severity = clamp01(
    R.lift_asym.weight * ramp(liftAsym, R.lift_asym.lo, R.lift_asym.hi) +
      R.smile_bs_asym.weight * ramp(bsAsym, R.smile_bs_asym.lo, R.smile_bs_asym.hi) +
      R.corner_height_diff.weight * ramp(cornerHeightDiff, R.corner_height_diff.lo, R.corner_height_diff.hi) +
      R.eye_aperture_asym.weight * ramp(apertureAsym, R.eye_aperture_asym.lo, R.eye_aperture_asym.hi),
  )

  // --- side + flags (patient's left/right) ---
  const flags: string[] = []
  const liftAbnormal = liftAsym >= R.lift_asym.lo
  const weakLiftSide: 'left' | 'right' = liftL < liftR ? 'left' : 'right'
  const side: Side = liftAbnormal ? weakLiftSide : 'none'
  if (liftAbnormal) flags.push(`${weakLiftSide} mouth corner lifts less`)

  if (bsAsym >= R.smile_bs_asym.lo) {
    const weakBs: 'left' | 'right' = smileL < smileR ? 'left' : 'right'
    flags.push(`smile weaker on the ${weakBs}`)
    if (liftAbnormal && weakBs !== weakLiftSide) {
      flags.push('blendshape and landmark disagree on the weaker side')
    }
  }
  if (cornerHeightDiff >= R.corner_height_diff.lo) {
    flags.push(`${sVL > sVR ? 'left' : 'right'} mouth corner sits lower in the smile`)
  }
  if (apertureAsym >= R.eye_aperture_asym.lo) {
    flags.push(`${apL < apR ? 'left' : 'right'} eye opening is narrower`)
  }
  if (flags.length === 0) flags.push('smile looks symmetric')

  const { startedAt, durationMs } = timing(all)
  return { test: 'face', severity: ROUND(severity), confidence: ROUND(confidence), metrics, flags, side, startedAt, durationMs }
}
