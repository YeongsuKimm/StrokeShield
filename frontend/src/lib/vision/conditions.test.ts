// Robustness of the three analyzers to real-world capture conditions and to healthy-but-unusual people. SYNTHETIC
// fixtures only (no real camera): they pin the DESIGN INTENT, shared anchors healthy <= 0.15 / borderline ~0.35 /
// clear >= 0.85, one retry cutoff (MIN_CONFIDENCE), and "degrade to a specific retry, never a confident wrong verdict".
// All thresholds under test are UNCALIBRATED.
import { describe, expect, it } from 'vitest'
import { toCanvasPoint } from '../../components/overlayDraw'
import { MIN_CONFIDENCE } from '../config'
import type { TestResult } from '../contracts'
import { computeRisk } from '../risk'
import { analyzeArms } from './arms'
import { analyzeEyes, type EyeFrame } from './eyes'
import { EYE_PROTOCOL_TOTAL_MS, targetAt } from './eyeProtocol'
import { analyzeFace, type FaceCaptureFrame } from './face'
import { BORDERLINE, droopLeft, droopRight, makeCapture, NATURAL_MILD, SYMMETRIC, type FaceSpec } from './faceTestUtils'
import type { Landmark, PoseFrame } from './landmarks'

const HEALTHY = 0.15
const CLEAR = 0.85

/** A completed result is either a retry with a reason or (healthy) low severity; never a confident high severity. */
const expectNotAlarming = (r: TestResult, max = HEALTHY) => {
  if (r.needsRetry) {
    expect(r.severity).toBe(0)
    expect(r.confidence).toBeLessThan(MIN_CONFIDENCE)
    expect(r.flags[0]).toBeTruthy()
  } else expect(r.severity).toBeLessThanOrEqual(max)
}

const face = (spec: FaceSpec) => {
  const { neutral, smile } = makeCapture(spec)
  return analyzeFace(neutral, smile)
}

describe('face: capture conditions', () => {
  const aspects = { '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '21:9': 21 / 9, 'portrait 9:16': 9 / 16, 'portrait 3:4': 3 / 4 }
  it.each(Object.entries(aspects))('healthy smile and clear droop are read the same at aspect %s', (_n, aspect) => {
    const healthy = face({ ...SYMMETRIC, aspect })
    expect(healthy.needsRetry).toBeFalsy()
    expect(healthy.severity).toBeLessThanOrEqual(HEALTHY)
    const left = face({ ...droopLeft(1), aspect })
    expect(left.severity).toBeGreaterThanOrEqual(CLEAR)
    expect(left.side).toBe('left')
    expect(face({ ...droopRight(1), aspect }).side).toBe('right')
  })

  it.each([5, 10, 15, 30])('low-fps device (%i fps) with timing jitter: same verdicts', (fps) => {
    const jitterMs = Math.min(0.35 * (1000 / fps), 30)
    expect(face({ ...SYMMETRIC, fps, jitterMs, seed: 3 }).severity).toBeLessThanOrEqual(HEALTHY)
    const d = face({ ...droopRight(1), fps, jitterMs, seed: 3 })
    expect(d.severity).toBeGreaterThanOrEqual(CLEAR)
    expect(d.side).toBe('right')
  })

  it('dropped frames (a 1.2 s stall in each capture) do not fake asymmetry or fail the run', () => {
    const gaps: [number, number][] = [
      [400, 1600],
      [2600, 3800],
    ]
    const r = face({ ...SYMMETRIC, fps: 12, gaps })
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBeLessThanOrEqual(HEALTHY)
  })

  it('camera pitched up/down (face compressed vertically) keeps healthy healthy and droop a droop', () => {
    for (const vScale of [0.6, 0.8, 1.2]) {
      expect(face({ ...SYMMETRIC, vScale }).severity).toBeLessThanOrEqual(HEALTHY)
      expect(face({ ...droopLeft(1), vScale }).severity).toBeGreaterThanOrEqual(CLEAR)
    }
  })

  it('tilted head (roll up to 30 degrees) at a non-16:9 aspect is not read as droop', () => {
    for (const rollDeg of [-30, -15, 15, 30]) {
      const r = face({ ...SYMMETRIC, rollDeg, aspect: 4 / 3 })
      expect(r.needsRetry).toBeFalsy()
      expect(r.severity).toBeLessThanOrEqual(HEALTHY)
    }
  })

  it('low light, harsh backlight-on-face and far subjects become a specific retry, not a verdict', () => {
    const dark = face({ ...droopLeft(1), brightness: 20 })
    expect(dark.needsRetry).toBe(true)
    expect(dark.flags.join(' ')).toMatch(/lighting/)
    const glare = face({ ...droopLeft(1), brightness: 250 })
    expect(glare.needsRetry).toBe(true)
    const far = face({ ...droopLeft(1), faceWidth: 0.13 })
    expect(far.needsRetry).toBe(true)
    expect(far.flags.join(' ')).toMatch(/too small/)
    const turned = face({ ...droopLeft(1), yawDeg: 30 })
    expect(turned.needsRetry).toBe(true)
    expect(turned.flags.join(' ')).toMatch(/turned/)
  })

  it('a horizontally mirrored feed (or upside-down) is a retry, never a swapped-side verdict', () => {
    const { neutral, smile } = makeCapture(droopLeft(1))
    const flip = (f: FaceCaptureFrame): FaceCaptureFrame => ({ ...f, landmarks: f.landmarks.map((p) => ({ ...p, x: 1 - p.x })) })
    const r = analyzeFace(neutral.map(flip), smile.map(flip))
    expect(r.needsRetry).toBe(true)
    expect(r.side).toBe('none')
  })

  it('a large face (subject very close) still gets a result, judged the same', () => {
    expect(face({ ...SYMMETRIC, faceWidth: 0.7 }).severity).toBeLessThanOrEqual(HEALTHY)
    expect(face({ ...droopLeft(1), faceWidth: 0.7 }).severity).toBeGreaterThanOrEqual(CLEAR)
  })
})

describe('face: false-positive review (healthy people who are asymmetric by nature)', () => {
  it('natural mild asymmetry stays under the healthy anchor', () => {
    expect(face(NATURAL_MILD).severity).toBeLessThanOrEqual(HEALTHY)
  })

  it('resting asymmetry (one mouth corner sits lower in both neutral and smile) stays healthy', () => {
    for (const rest of [0.02, 0.035, 0.05]) {
      const r = face({ ...SYMMETRIC, restR: rest })
      expect(r.needsRetry).toBeFalsy()
      expect(r.severity).toBeLessThanOrEqual(HEALTHY)
    }
  })

  it('a one-sided habitual smile is at most borderline and can never alert on its own', () => {
    const habitual: FaceSpec = { ...SYMMETRIC, liftR: 0.14 * 0.75, bsR: 0.7 * 0.72, restR: 0.02 }
    const r = face(habitual)
    expect(r.severity).toBeLessThan(0.5)
    expect(computeRisk({ face: r }).triggered).toBe(false)
    expect(face(BORDERLINE).severity).toBeLessThan(0.5)
    // A strong habit (40% weaker lift on one side plus a lower resting corner) is a real ambiguous case: above borderline,
    // but it must stay well short of the clear-deficit anchor and never alert on its own.
    const strong = face({ ...SYMMETRIC, liftR: 0.14 * 0.6, bsR: 0.7 * 0.6, restR: 0.03 })
    expect(strong.severity).toBeLessThan(0.75)
    expect(computeRisk({ face: strong }).triggered).toBe(false)
  })

  it('talking during the neutral phase does not create a verdict (healthy stays healthy or retries)', () => {
    for (const talk of [0.02, 0.04, 0.06]) expectNotAlarming(face({ ...SYMMETRIC, talk, seed: 5 }))
  })

  it('blinking during the smile (both eyes shut in 20% of frames) does not fake eye asymmetry', () => {
    const r = face({ ...SYMMETRIC, blinkFrac: 0.2, seed: 9 })
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBeLessThanOrEqual(HEALTHY)
  })

  it('the healthy variants are stable across seeds (noise cannot push a healthy face past the anchor)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = face({ ...SYMMETRIC, seed, noise: 0.004, talk: 0.02, blinkFrac: 0.1, jitterMs: 15, fps: 12 })
      expectNotAlarming(r)
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// ARMS
// ---------------------------------------------------------------------------------------------------------------------
interface ArmSpec {
  thetaL?: (tSec: number) => number
  thetaR?: (tSec: number) => number
  fps?: number
  jitterMs?: number
  aspect?: number
  rollDeg?: number // camera roll: the whole scene rotates about the image centre
  leanDeg?: number // patient leans: the whole body (shoulders + arms) rotates about the neck, camera level
  gaps?: [number, number][]
  lostLeftWristFromS?: number // from this time the left wrist is out of frame (visibility 0)
  shoulderW?: number
  seed?: number
}
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296 - 0.5
}
function armFrames(o: ArmSpec = {}): PoseFrame[] {
  const { fps = 20, aspect = 16 / 9, shoulderW = 0.16 } = o
  const thetaL = o.thetaL ?? (() => 0)
  const thetaR = o.thetaR ?? (() => 0)
  const rnd = rng(o.seed ?? 4)
  const out: PoseFrame[] = []
  const dt = 1000 / fps
  const roll = (((o.rollDeg ?? 0) + (o.leanDeg ?? 0)) * Math.PI) / 180
  const c = Math.cos(roll)
  const s = Math.sin(roll)
  for (let ms = 0; ms <= 10_000; ms += dt) {
    if ((o.gaps ?? []).some(([a, b]) => ms >= a && ms < b)) continue
    const tSec = ms / 1000
    const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }))
    // body frame in height units, origin at the neck: x right (image), y down
    const half = (shoulderW * aspect) / 2
    const put = (idx: number, bx: number, by: number, vis = 0.99) => {
      const px = bx * c - by * s
      const py = bx * s + by * c
      lm[idx] = { x: (0.5 * aspect + px) / aspect, y: 0.4 + py, z: 0, visibility: vis }
    }
    const arm = (sIdx: number, eIdx: number, wIdx: number, dir: 1 | -1, thetaDeg: number, wristVis = 0.99) => {
      const th = (thetaDeg * Math.PI) / 180
      const len = Math.min(0.5, 0.45 * aspect - half - 0.02) // keeps the wrist inside a narrow (portrait / square) frame
      put(sIdx, dir * half, 0)
      put(eIdx, dir * (half + (len * Math.cos(th)) / 2), (-len * Math.sin(th)) / 2)
      put(wIdx, dir * (half + len * Math.cos(th)), -len * Math.sin(th), wristVis)
    }
    arm(11, 13, 15, 1, thetaL(tSec), o.lostLeftWristFromS !== undefined && tSec >= o.lostLeftWristFromS ? 0 : 0.99)
    arm(12, 14, 16, -1, thetaR(tSec))
    const t = 1_700_000_000_000 + ms + (o.jitterMs ? rnd() * 2 * o.jitterMs : 0)
    out.push({ landmarks: lm.map((p) => ({ ...p, x: p.x + rnd() * 0.004, y: p.y + rnd() * 0.004 })), t })
  }
  return out
}
const sink = (amount: number, from = 1, to = 7) => (t: number) => -amount * Math.min(1, Math.max(0, (t - from) / (to - from)))

describe('arms: capture conditions', () => {
  const aspects = { '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, portrait: 9 / 16 }
  it.each(Object.entries(aspects))('aspect %s: steady is healthy, a 30 degree drop is clear on the right side', (_n, aspect) => {
    const steady = analyzeArms(armFrames({ aspect }), { aspectRatio: aspect })
    expect(steady.needsRetry).toBeFalsy()
    expect(steady.severity).toBeLessThanOrEqual(HEALTHY)
    const drop = analyzeArms(armFrames({ aspect, thetaR: sink(30) }), { aspectRatio: aspect })
    expect(drop.severity).toBeGreaterThanOrEqual(CLEAR)
    expect(drop.side).toBe('right')
  })

  it.each([8, 10, 15, 30])('%i fps with jitter: no fake motion, real drift still found', (fps) => {
    const jitterMs = Math.min(0.3 * (1000 / fps), 25)
    const steady = analyzeArms(armFrames({ fps, jitterMs }))
    expectNotAlarming(steady)
    expect(steady.needsRetry).toBeFalsy()
    const drop = analyzeArms(armFrames({ fps, jitterMs, thetaL: sink(30) }))
    expect(drop.severity).toBeGreaterThanOrEqual(CLEAR)
    expect(drop.side).toBe('left')
  })

  it('dropped frames (1.5 s stalls) do not fake drift', () => {
    const r = analyzeArms(
      armFrames({
        fps: 15,
        gaps: [
          [2000, 3500],
          [6000, 7500],
        ],
      }),
    )
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBeLessThanOrEqual(HEALTHY)
  })

  it('a rolled camera or a patient leaning does not read as one arm held lower', () => {
    for (const rollDeg of [-15, -8, 8, 15]) {
      const r = analyzeArms(armFrames({ rollDeg }))
      expect(r.needsRetry).toBeFalsy()
      expect(r.severity).toBeLessThanOrEqual(HEALTHY)
      expect(r.side).toBe('none')
    }
    const lean = analyzeArms(armFrames({ leanDeg: 12 }))
    expect(lean.severity).toBeLessThanOrEqual(HEALTHY)
    // ... and a real drop is still found under camera roll
    const drop = analyzeArms(armFrames({ rollDeg: 12, thetaL: sink(30) }))
    expect(drop.severity).toBeGreaterThanOrEqual(CLEAR)
    expect(drop.side).toBe('left')
  })

  it('a wrist out of frame for the last 4 s is a retry ("keep both hands in view"), never a verdict', () => {
    const r = analyzeArms(armFrames({ lostLeftWristFromS: 6 }))
    expect(r.needsRetry).toBe(true)
    expect(r.severity).toBe(0)
    expect(r.flags[0]).toBeTruthy()
  })

  it('a wrist that leaves the frame only briefly (0.6 s) still scores, healthy', () => {
    const frames = armFrames({ fps: 20 })
    const bad = frames.map((f) => (f.t - frames[0].t > 4000 && f.t - frames[0].t < 4600 ? { ...f, landmarks: f.landmarks.map((p, i) => (i === 15 ? { ...p, visibility: 0 } : p)) } : f))
    const r = analyzeArms(bad)
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBeLessThanOrEqual(HEALTHY)
  })

  it('a subject too far away (narrow shoulders) is a retry', () => {
    const r = analyzeArms(armFrames({ shoulderW: 0.06 }))
    expect(r.needsRetry).toBe(true)
    expect(r.severity).toBe(0)
  })

  it('a naturally lower arm and slightly uneven shoulders stay under the healthy anchor', () => {
    expect(analyzeArms(armFrames({ thetaR: () => -6 })).severity).toBeLessThanOrEqual(HEALTHY)
    expect(analyzeArms(armFrames({ leanDeg: 4, thetaL: () => 3, thetaR: () => -3 })).severity).toBeLessThanOrEqual(HEALTHY)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// EYES
// ---------------------------------------------------------------------------------------------------------------------
interface EyeSpec {
  ampL?: number // excursion (eye widths) when the dot is on the patient's left, both eyes
  ampR?: number
  fps?: number
  jitterMs?: number
  aspect?: number
  rollDeg?: number
  dropFrac?: number // fraction of frames with no face at all (hair, occlusion, tracking loss)
  blinkFrac?: number
  noise?: number // eye widths of iris jitter (glasses glare, hair strands)
  noiseFrom?: number // ms: iris noise only after this time (hair falling over the eyes mid-run)
  seed?: number
}
function eyeRun(o: EyeSpec = {}): EyeFrame[] {
  const { fps = 30, aspect = 4 / 3, ampL = 0.1, ampR = 0.1 } = o
  const H = 480
  const W = H * aspect
  const rnd = rng(o.seed ?? 11)
  const roll = ((o.rollDeg ?? 0) * Math.PI) / 180
  const dt = 1000 / fps
  const out: EyeFrame[] = []
  for (let ms = 0; ms < EYE_PROTOCOL_TOTAL_MS; ms += dt) {
    const target = targetAt(ms)
    const t = 1000 + ms + (o.jitterMs ? rnd() * 2 * o.jitterMs : 0)
    if (rnd() + 0.5 < (o.dropFrac ?? 0)) {
      out.push({ face: { landmarks: [], blendshapes: {}, t }, target })
      continue
    }
    // smooth step towards the plateau (250 ms)
    let start = 0
    let prev = 0
    let cur = 0
    for (const [tg, len] of [['center', 1000], ['left', 2000], ['center', 1000], ['right', 2000], ['center', 1000]] as const) {
      const pl = tg === 'left' ? ampL : tg === 'right' ? -ampR : 0
      if (ms < start + len) {
        cur = pl
        break
      }
      prev = pl
      start += len
      cur = 0
    }
    const k = Math.min(1, Math.max(0, (ms - start - 200) / 250))
    const g = 0.5 + prev * (1 - k) + cur * k
    const nz = ms >= (o.noiseFrom ?? 0) ? (o.noise ?? 0) : 0
    const gR = g + nz * rnd()
    const gL = g + nz * rnd()
    const ew = 46
    const local = new Map<number, [number, number]>([
      [33, [-62, 0]],
      [133, [-62 + ew, 0]],
      [263, [62, 0]],
      [362, [62 - ew, 0]],
      [468, [-62 + gR * ew, 0]],
      [473, [62 - (1 - gL) * ew, 0]],
      [234, [-100, 40]],
      [454, [100, 40]],
    ])
    const lm: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
    for (const [i, [lx, ly]] of local) {
      lm[i] = { x: (W / 2 + lx * Math.cos(roll) - ly * Math.sin(roll)) / W, y: (H / 2 + lx * Math.sin(roll) + ly * Math.cos(roll)) / H, z: 0 }
    }
    const blink = rnd() + 0.5 < (o.blinkFrac ?? 0)
    out.push({
      face: { landmarks: lm, blendshapes: blink ? { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 } : {}, yawDeg: 0, t, brightness: 130 } as EyeFrame['face'],
      target,
    })
  }
  return out
}
const eyes = (o: EyeSpec) => analyzeEyes(eyeRun(o), { aspect: o.aspect ?? 4 / 3, startedAt: 0 })

describe('eyes: capture conditions and healthy variation', () => {
  it.each([[16 / 9], [4 / 3], [1], [9 / 16]])('healthy at aspect %f, even with a rolled head', (aspect) => {
    for (const rollDeg of [0, 15, -20]) expectNotAlarming(eyes({ aspect, rollDeg }))
  })

  it.each([10, 15, 30])('%i fps with timing jitter: healthy stays healthy, one-sided failure found', (fps) => {
    const jitterMs = Math.min(0.3 * (1000 / fps), 25)
    const h = eyes({ fps, jitterMs })
    expect(h.needsRetry).toBeFalsy()
    expect(h.severity).toBeLessThanOrEqual(HEALTHY)
    const bad = eyes({ fps, jitterMs, ampL: 0.005 })
    expect(bad.needsRetry).toBeFalsy()
    expect(bad.severity).toBeGreaterThanOrEqual(CLEAR)
    expect(bad.side).toBe('left')
  })

  it('natural left/right amplitude difference (0.11 vs 0.07 eye widths) stays healthy', () => {
    const r = eyes({ ampL: 0.11, ampR: 0.07 })
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBeLessThanOrEqual(HEALTHY)
  })

  it('blinking in 15% of frames and 25% tracking dropouts (hair over the eyes) never alarm', () => {
    expectNotAlarming(eyes({ blinkFrac: 0.15 }))
    expectNotAlarming(eyes({ dropFrac: 0.25, seed: 3 }))
    expectNotAlarming(eyes({ dropFrac: 0.25, blinkFrac: 0.1, noise: 0.02, noiseFrom: 3000, seed: 8 }))
  })

  it('heavy glare / hair jitter or losing the eyes most of the time is a retry with a reason, not a verdict', () => {
    const glare = eyes({ noise: 0.35 })
    const lost = eyes({ dropFrac: 0.85 })
    for (const r of [glare, lost]) {
      expect(r.severity <= HEALTHY || r.needsRetry).toBe(true)
      if (r.needsRetry) expect(r.flags[0]).toBeTruthy()
    }
    expect(lost.needsRetry).toBe(true)
  })

  it('jittery iris landmarks never produce a high-confidence severe result for a healthy person', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = eyes({ noise: 0.06, seed, dropFrac: 0.1, blinkFrac: 0.05, fps: 15, jitterMs: 15 })
      if (!r.needsRetry) expect(r.severity <= HEALTHY || r.confidence < 0.6).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// LEFT / RIGHT
// ---------------------------------------------------------------------------------------------------------------------
describe('patient left/right is one convention across face, arms, eyes and the mirrored display', () => {
  it('a deficit on the patient\'s LEFT is reported as "left" by all three analyzers; RIGHT as "right"', () => {
    expect(face(droopLeft(1)).side).toBe('left')
    expect(face(droopRight(1)).side).toBe('right')
    expect(analyzeArms(armFrames({ thetaL: sink(30) })).side).toBe('left')
    expect(analyzeArms(armFrames({ thetaR: sink(30) })).side).toBe('right')
    expect(eyes({ ampL: 0.005 }).side).toBe('left') // cannot look to the patient's left
    expect(eyes({ ampR: 0.005 }).side).toBe('right')
  })

  it('in the raw frame the patient\'s LEFT is on the image RIGHT, and the mirrored display puts it on the LEFT of the screen', () => {
    const frames = armFrames({ thetaL: () => 0 })
    const lm = frames[0].landmarks
    expect(lm[15].x).toBeGreaterThan(lm[16].x) // landmark 15 (patient's left wrist) has the larger raw x
    const { x } = toCanvasPoint(lm[15], 100, 100, true) // draw layer mirrors like a mirror: your left hand is on the left
    expect(x).toBeLessThan(50)
    expect(toCanvasPoint(lm[16], 100, 100, true).x).toBeGreaterThan(50)
    // unmirrored drawing keeps raw geometry
    expect(toCanvasPoint(lm[15], 100, 100, false).x).toBeGreaterThan(50)
  })

  it('the tolerance changes did not alter the left/right meaning under a rolled camera', () => {
    expect(analyzeArms(armFrames({ rollDeg: -12, thetaR: sink(30) })).side).toBe('right')
  })
})
