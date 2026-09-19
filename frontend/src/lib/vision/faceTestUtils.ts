// Synthetic face-frame generators for face.test.ts. Encodes the left/right mapping documented at the top of face.ts:
// patient's RIGHT = image-left (landmarks 33, 61, 159/145), patient's LEFT = image-right (263, 291, 386/374),
// blendshape "Left" = patient's left.
import type { Landmark } from './landmarks'
import type { FaceCaptureFrame } from './face'

export const ASPECT = 16 / 9
const DEFAULT_ASPECT = ASPECT

// Face-space layout in IOD units: origin at eye midpoint, u to image-right, v DOWN.
const BASE: Record<number, [number, number]> = {
  33: [-0.5, 0],
  263: [0.5, 0],
  133: [-0.2, 0],
  362: [0.2, 0],
  159: [-0.35, -0.06],
  145: [-0.35, 0.06],
  386: [0.35, -0.06],
  374: [0.35, 0.06],
  1: [0, 0.6],
  61: [-0.3, 1.15],
  291: [0.3, 1.15],
  234: [-0.9, 0.4],
  454: [0.9, 0.4],
  152: [0, 1.9],
}

export interface FaceSpec {
  /** Corner lift in IOD units during the smile hold (patient's left / right). */
  liftL: number
  liftR: number
  /** Smile blendshapes at full smile (patient's left / right). */
  bsL: number
  bsR: number
  /** Extra eye narrowing at full smile, 0..1 of the aperture, per side (patient's). */
  squintL?: number
  squintR?: number
  rollDeg?: number
  yawDeg?: number
  /** Face width as a fraction of frame width (234 -> 454 distance). */
  faceWidth?: number
  brightness?: number
  nNeutral?: number
  nSmile?: number
  seed?: number
  noise?: number // IOD units
  // --- robustness scenarios (conditions.test.ts) ---
  aspect?: number // video width / height (default 16:9); landmarks are re-normalized per axis
  restL?: number // constant vertical offset (IOD units, + = lower) of the patient's LEFT mouth corner, present in neutral AND smile
  restR?: number
  vScale?: number // vertical compression of the whole face (camera pitched up/down at a steep angle), default 1
  talk?: number // IOD units of random mouth-corner motion + smile-blendshape flicker while the neutral capture is "talking"
  blinkFrac?: number // fraction of frames in which BOTH eyes are shut (aperture collapses, blink blendshapes set)
  fps?: number // default 15
  jitterMs?: number // uniform +-jitterMs timing jitter per frame (frames stay ordered)
  gaps?: [number, number][] // [fromMs, toMs) windows (relative to the capture start) in which frames are dropped
}

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Build one 478-point frame. `smileProgress` 0 = neutral, 1 = full smile. */
function makeFrame(spec: FaceSpec, smileProgress: number, t: number, rand: () => number, talking = false): FaceCaptureFrame {
  const p = smileProgress
  const ASPECT = spec.aspect ?? DEFAULT_ASPECT
  const faceWidth = spec.faceWidth ?? 0.35
  // face width (1.8 IOD) as fraction of frame width -> IOD in image-height units
  const iodH = (faceWidth / 1.8) * ASPECT
  const roll = ((spec.rollDeg ?? 0) * Math.PI) / 180
  const cos = Math.cos(roll)
  const sin = Math.sin(roll)
  const noise = spec.noise ?? 0.002
  const cx = 0.5 * ASPECT
  const cy = 0.4

  const lm: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  for (const [k, [u0, v0]] of Object.entries(BASE)) {
    const idx = Number(k)
    let u = u0
    let v = v0
    // lids: squint moves the upper lid down and the lower lid up
    if (idx === 291) v -= spec.liftL * p - (spec.restL ?? 0)
    if (idx === 61) v -= spec.liftR * p - (spec.restR ?? 0)
    if (talking && (idx === 291 || idx === 61)) v += (rand() - 0.5) * 2 * (spec.talk ?? 0)
    if (idx === 386) v += 0.06 * (spec.squintL ?? 0) * p
    if (idx === 374) v -= 0.06 * (spec.squintL ?? 0) * p
    if (idx === 159) v += 0.06 * (spec.squintR ?? 0) * p
    if (idx === 145) v -= 0.06 * (spec.squintR ?? 0) * p
    u += (rand() - 0.5) * 2 * noise
    v += (rand() - 0.5) * 2 * noise
    // face space -> height-unit image space, then rotate by roll about the frame-space face center.
    const X = u * iodH
    const Y = v * iodH * (spec.vScale ?? 1)
    const Xr = X * cos - Y * sin
    const Yr = X * sin + Y * cos
    lm[idx] = { x: (cx + Xr) / ASPECT, y: cy + Yr, z: 0 }
  }
  const blink = rand() < (spec.blinkFrac ?? 0)
  if (blink) {
    for (const [top, bot] of [
      [159, 145],
      [386, 374],
    ]) lm[bot] = { ...lm[top], y: lm[top].y + 0.0005 }
  }
  const flick = talking ? (rand() - 0.5) * 2 * (spec.talk ?? 0) * 4 : 0 // blendshape flicker while talking
  return {
    landmarks: lm,
    blendshapes: {
      mouthSmileLeft: Math.max(0, spec.bsL * p + flick),
      mouthSmileRight: Math.max(0, spec.bsR * p + flick),
      ...(blink ? { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 } : {}),
    },
    yawDeg: spec.yawDeg ?? 0,
    t,
    brightness: spec.brightness ?? 130,
    aspect: ASPECT,
  }
}

/** Neutral capture (1.5 s @ ~15 fps) and smile capture (3 s @ ~15 fps, ramping up over the first 1 s then holding). */
export function makeCapture(spec: FaceSpec): { neutral: FaceCaptureFrame[]; smile: FaceCaptureFrame[] } {
  const rand = rng(spec.seed ?? 1)
  const fps = spec.fps ?? 15
  const dt = 1000 / fps
  const nN = spec.nNeutral ?? Math.round(1.5 * fps)
  const nS = spec.nSmile ?? Math.round(3 * fps)
  const t0 = 1_700_000_000_000
  const jit = () => (spec.jitterMs ? (rand() - 0.5) * 2 * spec.jitterMs : 0)
  const dropped = (i: number) => (spec.gaps ?? []).some(([a, b]) => i * dt >= a && i * dt < b)
  const smileRamp = Math.max(1, fps) // ramp up over the first second
  const neutral: FaceCaptureFrame[] = []
  for (let i = 0; i < nN; i++) {
    if (dropped(i)) continue
    neutral.push(makeFrame(spec, 0, t0 + i * dt + jit(), rand, true))
  }
  const smile: FaceCaptureFrame[] = []
  for (let i = 0; i < nS; i++) {
    if (dropped(nN + i)) continue
    smile.push(makeFrame(spec, Math.min(1, i / smileRamp), t0 + (nN + i) * dt + jit(), rand))
  }
  return { neutral, smile }
}

/** A healthy, symmetric smile. */
export const SYMMETRIC: FaceSpec = { liftL: 0.14, liftR: 0.14, bsL: 0.7, bsR: 0.7 }

/** Droop on the patient's LEFT: left corner barely lifts, left blendshape low. */
export const droopLeft = (severity = 1): FaceSpec => ({
  ...SYMMETRIC,
  liftL: 0.14 * (1 - 0.85 * severity),
  bsL: 0.7 * (1 - 0.8 * severity),
})

/** Droop on the patient's RIGHT. */
export const droopRight = (severity = 1): FaceSpec => ({
  ...SYMMETRIC,
  liftR: 0.14 * (1 - 0.85 * severity),
  bsR: 0.7 * (1 - 0.8 * severity),
})

/** Natural mild asymmetry seen in healthy faces (~18 % lift difference). */
export const NATURAL_MILD: FaceSpec = { ...SYMMETRIC, liftR: 0.14 * 0.82, bsR: 0.7 * 0.78 }

/** Borderline / ambiguous (~30 % lift difference). */
export const BORDERLINE: FaceSpec = { ...SYMMETRIC, liftR: 0.14 * 0.7, bsR: 0.7 * 0.65 }
