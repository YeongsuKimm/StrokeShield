import { describe, expect, it } from 'vitest'
import { MIN_CONFIDENCE } from '../config'
import { EYE_MSG } from './eyeAdvice'
import { analyzeEyes, EYES_CONFIG, type EyeFrame } from './eyes'
import { EYE_PROTOCOL, EYE_PROTOCOL_TOTAL_MS, labelEyeFrames, targetAt } from './eyeProtocol'
import type { FaceFrame, Landmark } from './landmarks'

const ASPECT = 640 / 480
const W = 640
const H = 480
const EYE_W = 46 // px, corner to corner
const FPS = 30

// Deterministic PRNG so "noise" is reproducible.
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296 - 0.5
}

interface Script {
  ampLeftR?: number // gaze excursion of the patient's RIGHT eye when the dot is on the patient's left
  ampLeftL?: number
  ampRightR?: number
  ampRightL?: number
  amp?: number // default amplitude for all four (eye widths)
  rest?: number // fixed gaze offset (leftward +) applied at all times
  latencyMs?: number
  noise?: number // eye widths, uniform +- noise/2
  rollDeg?: number
  yawDeg?: number
  yawJitter?: number
  noIris?: boolean
  faceWidthPx?: number
  scale?: number // shrink the whole face (subject far from the camera)
  seed?: number
}

/** Gaze (leftward +, 0.5 centered) of each eye at time t, given the previous-segment gaze for smooth returns. */
function gazeAt(tMs: number, s: Script): { gR: number; gL: number } {
  const amp = s.amp ?? 0.1
  const aLR = s.ampLeftR ?? amp
  const aLL = s.ampLeftL ?? amp
  const aRR = s.ampRightR ?? amp
  const aRL = s.ampRightL ?? amp
  const lat = s.latencyMs ?? 250
  // Piecewise: each eye's gaze = 0.5 + rest + sum over segments of smooth steps. Simpler: evaluate the offset at the
  // start of the current segment (previous target's plateau) and blend to the new plateau.
  const plateau = (target: 'center' | 'left' | 'right', eye: 'R' | 'L'): number => {
    if (target === 'left') return eye === 'R' ? aLR : aLL
    if (target === 'right') return -(eye === 'R' ? aRR : aRL)
    return 0
  }
  let start = 0
  let prev: 'center' | 'left' | 'right' = 'center'
  let cur: 'center' | 'left' | 'right' = 'center'
  for (const seg of EYE_PROTOCOL) {
    if (tMs < start + seg.ms) {
      cur = seg.target
      break
    }
    prev = seg.target
    start += seg.ms
    cur = 'center'
  }
  const p = Math.min(1, Math.max(0, (tMs - start - lat) / 250))
  const mix = (eye: 'R' | 'L') => plateau(prev, eye) * (1 - p) + plateau(cur, eye) * p
  return { gR: 0.5 + (s.rest ?? 0) + mix('R'), gL: 0.5 + (s.rest ?? 0) + mix('L') }
}

function makeFace(tMs: number, s: Script, rnd: () => number): FaceFrame {
  const { gR, gL } = gazeAt(tMs, s)
  const n = s.noise ?? 0
  const gRn = gR + n * rnd()
  const gLn = gL + n * rnd()
  const roll = ((s.rollDeg ?? 0) * Math.PI) / 180
  const cx = 320
  const cy = 240
  // face-local pixel coordinates, x = image right (= patient-left), y = image down
  const sc = s.scale ?? 1
  const ew = EYE_W * sc
  const local = new Map<number, [number, number]>()
  local.set(33, [-62 * sc, 0]) // patient's RIGHT eye outer (image left)
  local.set(133, [-62 * sc + ew, 0])
  local.set(263, [62 * sc, 0]) // patient's LEFT eye outer (image right)
  local.set(362, [62 * sc - ew, 0])
  // right eye: iris.x = outer.x + g*ew ; left eye: ratio = 1-g, iris.x = outer.x - ratio*ew
  local.set(468, [-62 * sc + gRn * ew, 0])
  local.set(473, [62 * sc - (1 - gLn) * ew, 0])
  const fw = ((s.faceWidthPx ?? 200) * sc) / 2
  local.set(234, [-fw, 40 * sc])
  local.set(454, [fw, 40 * sc])
  const landmarks: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  for (const [i, [lx, ly]] of local) {
    const x = cx + lx * Math.cos(roll) - ly * Math.sin(roll)
    const y = cy + lx * Math.sin(roll) + ly * Math.cos(roll)
    landmarks[i] = { x: x / W, y: y / H, z: 0 }
  }
  // Fill the remaining points near the face so the span is defined by 234/454.
  const out = s.noIris ? landmarks.slice(0, 468) : landmarks
  const yaw = (s.yawDeg ?? 0) + (s.yawJitter ?? 0) * rnd()
  return { landmarks: out, blendshapes: {}, yawDeg: yaw, t: 1000 + tMs }
}

function run(s: Script = {}): EyeFrame[] {
  const rnd = rng(s.seed ?? 7)
  const frames: EyeFrame[] = []
  const dt = 1000 / FPS
  for (let t = 0; t < EYE_PROTOCOL_TOTAL_MS; t += dt) {
    frames.push({ face: makeFace(t, s, rnd), target: targetAt(t) })
  }
  return frames
}

const analyze = (frames: EyeFrame[]) => analyzeEyes(frames, { aspect: ASPECT, startedAt: 0 })

describe('targetAt / protocol', () => {
  it('follows center 1s, left 2s, center 1s, right 2s, center 1s with correct boundaries', () => {
    expect(targetAt(0)).toBe('center')
    expect(targetAt(999)).toBe('center')
    expect(targetAt(1000)).toBe('left')
    expect(targetAt(2999)).toBe('left')
    expect(targetAt(3000)).toBe('center')
    expect(targetAt(3999)).toBe('center')
    expect(targetAt(4000)).toBe('right')
    expect(targetAt(5999)).toBe('right')
    expect(targetAt(6000)).toBe('center')
    expect(targetAt(6999)).toBe('center')
  })
  it('is safe before start, after the end and for garbage input', () => {
    expect(targetAt(-5)).toBe('center')
    expect(targetAt(EYE_PROTOCOL_TOTAL_MS)).toBe('center')
    expect(targetAt(1e9)).toBe('center')
    expect(targetAt(NaN)).toBe('center')
  })
  it('totals 7 seconds', () => expect(EYE_PROTOCOL_TOTAL_MS).toBe(7000))
  it('labelEyeFrames labels by protocol time and drops frames outside the window', () => {
    const faces = [500, 1500, 4500, 8000].map((t) => ({ landmarks: [], blendshapes: {}, t: 100 + t }) as FaceFrame)
    faces.unshift({ landmarks: [], blendshapes: {}, t: 50 })
    expect(labelEyeFrames(faces, 100).map((f) => f.target)).toEqual(['center', 'left', 'right'])
  })
})

describe('analyzeEyes: normal tracking', () => {
  it('has low severity, decent confidence and no side', () => {
    const r = analyze(run())
    expect(r.test).toBe('eyes')
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBeLessThanOrEqual(0.15)
    expect(r.confidence).toBeGreaterThan(0.6)
    expect(r.side).toBe('none')
    expect(r.metrics.exc_left).toBeCloseTo(0.1, 2)
    expect(r.metrics.exc_right).toBeCloseTo(0.1, 2)
    expect(r.metrics.excursion_asym).toBeCloseTo(0, 2)
    expect(r.metrics.rest_deviation).toBeCloseTo(0, 2)
    expect(r.metrics.tracking_lag_s).toBeGreaterThan(0.2)
    expect(r.metrics.tracking_lag_s).toBeLessThan(0.8)
    expect(r.flags).toContain('eyes followed the dot symmetrically')
  })
  it('healthy variation (noise, 25% amplitude difference, small offset) stays <= 0.15', () => {
    const r = analyze(run({ ampLeftR: 0.11, ampLeftL: 0.1, ampRightR: 0.085, ampRightL: 0.08, rest: 0.02, noise: 0.02 }))
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBeLessThanOrEqual(0.15)
  })
  it('all metrics are finite numbers', () => {
    for (const v of Object.values(analyze(run({ noise: 0.02 })).metrics)) expect(Number.isFinite(v)).toBe(true)
  })
})

describe('analyzeEyes: gaze palsy (cannot look one way)', () => {
  it('cannot look left -> side left, severity >= 0.85', () => {
    const r = analyze(run({ ampLeftR: 0.005, ampLeftL: 0.005 }))
    expect(r.needsRetry).toBeFalsy()
    expect(r.side).toBe('left')
    expect(r.severity).toBeGreaterThanOrEqual(0.85)
    expect(r.metrics.excursion_asym).toBeGreaterThan(0.8)
    expect(r.flags).toContain('gaze does not reach the left')
  })
  it('cannot look right -> side right, severity >= 0.85', () => {
    const r = analyze(run({ ampRightR: 0.005, ampRightL: 0.005 }))
    expect(r.needsRetry).toBeFalsy()
    expect(r.side).toBe('right')
    expect(r.severity).toBeGreaterThanOrEqual(0.85)
  })
  it('works with noise', () => {
    const r = analyze(run({ ampLeftR: 0.005, ampLeftL: 0.005, noise: 0.02 }))
    expect(r.side).toBe('left')
    expect(r.severity).toBeGreaterThanOrEqual(0.85)
  })
  it('partial deficit (about half amplitude one side) is borderline: 0.2-0.6', () => {
    const r = analyze(run({ ampLeftR: 0.05, ampLeftL: 0.05 }))
    expect(r.side).toBe('left')
    expect(r.severity).toBeGreaterThan(0.2)
    expect(r.severity).toBeLessThan(0.6)
  })
  it('severity is monotonic as the left excursion shrinks', () => {
    let prev = -1
    for (const a of [0.1, 0.085, 0.07, 0.055, 0.04, 0.025, 0.01, 0]) {
      const r = analyze(run({ ampLeftR: a, ampLeftL: a }))
      expect(r.needsRetry).toBeFalsy()
      expect(r.severity).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = r.severity
    }
    expect(prev).toBeGreaterThanOrEqual(0.85)
  })
})

describe('analyzeEyes: conjugacy and rest deviation', () => {
  it('one eye barely moves in both directions -> conjugacy_err high, no side', () => {
    const r = analyze(run({ ampLeftL: 0.02, ampRightL: 0.02 }))
    expect(r.needsRetry).toBeFalsy()
    expect(r.metrics.conjugacy_err).toBeGreaterThan(0.7)
    expect(r.metrics.excursion_asym).toBeLessThan(0.1)
    expect(r.side).toBe('none')
    expect(r.severity).toBeGreaterThan(0.25)
    expect(r.severity).toBeLessThan(0.5)
    expect(r.flags).toContain('eyes move unequally (one eye lagging)')
  })
  it('per-eye excursions are reported with patient-eye suffixes', () => {
    const r = analyze(run({ ampLeftR: 0.12, ampLeftL: 0.06 }))
    expect(r.metrics.exc_left_r_eye).toBeCloseTo(0.12, 2)
    expect(r.metrics.exc_left_l_eye).toBeCloseTo(0.06, 2)
  })
  it('fixed gaze deviation at rest -> rest_deviation reflects it and severity rises', () => {
    const base = analyze(run())
    const r = analyze(run({ rest: 0.2 }))
    expect(r.needsRetry).toBeFalsy()
    expect(r.metrics.rest_deviation).toBeCloseTo(0.2, 2)
    expect(r.severity).toBeGreaterThan(base.severity + 0.1)
    expect(r.flags).toContain('gaze rests off center')
  })
  it('deviation direction does not matter', () => {
    expect(analyze(run({ rest: -0.2 })).metrics.rest_deviation).toBeCloseTo(0.2, 2)
  })
})

describe('analyzeEyes: left/right convention', () => {
  it('a raw-frame iris moving to image +x while the dot is on the patient LEFT counts as excursion', () => {
    // sanity of the generator + mapping: leftward gaze is +x in the raw image for both irises
    const frames = run({ amp: 0.1 })
    const left = frames.find((f) => f.target === 'left' && f.face.t - 1000 > 2500)!
    const center = frames[0]
    expect(left.face.landmarks[468].x).toBeGreaterThan(center.face.landmarks[468].x)
    expect(left.face.landmarks[473].x).toBeGreaterThan(center.face.landmarks[473].x)
    expect(left.face.landmarks[33].x).toBeLessThan(left.face.landmarks[263].x) // 33 = patient's right eye, image left
    expect(analyze(frames).metrics.exc_left).toBeGreaterThan(0.09)
  })
  it('swapped target labels (wrong mirroring) are caught: gaze moved opposite -> needsRetry with a hint', () => {
    const flip = { left: 'right', right: 'left', center: 'center' } as const
    const wrong = run().map((f) => ({ ...f, target: flip[f.target] }))
    const r = analyze(wrong)
    expect(r.needsRetry).toBe(true)
    expect(r.flags.join(' ')).toMatch(/opposite/)
  })
})

describe('analyzeEyes: quality gates', () => {
  it('no movement at all is a COMPLETED behavioral result, not a retry (see "BEHAVIORAL outcomes" below)', () => {
    expect(analyze(run({ amp: 0 })).needsRetry).toBeFalsy()
  })
  it('head yawed 20deg -> frames rejected -> needsRetry (choice: reject, not compensate)', () => {
    const r = analyze(run({ yawDeg: 20 }))
    expect(r.needsRetry).toBe(true)
    expect(r.confidence).toBeLessThan(MIN_CONFIDENCE)
    expect(r.flags.join(' ')).toMatch(/head turned/)
  })
  it('yaw just inside the limit is accepted', () => {
    const r = analyze(run({ yawDeg: EYES_CONFIG.maxYawDeg - 1 }))
    expect(r.needsRetry).toBeFalsy()
  })
  it('head moving a lot (yaw jitter +-15) lowers confidence or retries', () => {
    const steady = analyze(run())
    const r = analyze(run({ yawJitter: 30 }))
    expect(r.needsRetry || r.confidence < steady.confidence).toBe(true)
  })
  it('missing iris landmarks (468 points) -> needsRetry, no throw', () => {
    const r = analyze(run({ noIris: true }))
    expect(r.needsRetry).toBe(true)
    expect(r.flags.join(' ')).toMatch(/iris/)
  })
  it('tiny face (too far) -> needsRetry or low confidence', () => {
    const r = analyze(run({ scale: 0.3 }))
    expect(r.needsRetry || r.confidence < 0.5).toBe(true)
  })
  it('very noisy irises -> lower confidence than clean', () => {
    const clean = analyze(run())
    const noisy = analyze(run({ noise: 0.08 }))
    expect(noisy.needsRetry || noisy.confidence < clean.confidence).toBe(true)
  })
  it('empty input, too few frames, single frame do not throw and retry', () => {
    expect(analyzeEyes([]).needsRetry).toBe(true)
    expect(analyzeEyes(run().slice(0, 10), { startedAt: 0 }).needsRetry).toBe(true)
    expect(analyzeEyes(run().slice(0, 1), { startedAt: 0 }).needsRetry).toBe(true)
    expect(analyzeEyes([], { startedAt: 0 }).test).toBe('eyes')
  })
  it('garbage landmarks (NaN, undefined entries) do not throw', () => {
    const frames = run().map((f, i) => {
      const lm = f.face.landmarks.slice()
      if (i % 2) lm[468] = { x: NaN, y: NaN, z: 0 }
      if (i % 3 === 0) lm[263] = undefined as unknown as Landmark
      return { ...f, face: { ...f.face, landmarks: lm } }
    })
    expect(() => analyze(frames)).not.toThrow()
    expect(analyze(frames).needsRetry).toBe(true)
  })
  it('both sides missing entirely -> retry (nothing to score; one missing side is a partial result, see below)', () => {
    expect(analyze(run().filter((f) => f.target === 'center')).needsRetry).toBe(true)
  })
})

describe('analyzeEyes: roll invariance', () => {
  it('rolling the head 15deg does not change the result', () => {
    const upright = analyze(run({ ampLeftR: 0.03, ampLeftL: 0.03, rest: 0.05 }))
    for (const deg of [15, -15]) {
      const rolled = analyze(run({ ampLeftR: 0.03, ampLeftL: 0.03, rest: 0.05, rollDeg: deg }))
      expect(rolled.severity).toBeCloseTo(upright.severity, 2)
      expect(rolled.side).toBe(upright.side)
      expect(rolled.metrics.exc_left).toBeCloseTo(upright.metrics.exc_left, 3)
      expect(rolled.metrics.exc_right).toBeCloseTo(upright.metrics.exc_right, 3)
      expect(rolled.metrics.rest_deviation).toBeCloseTo(upright.metrics.rest_deviation, 3)
    }
  })
})

describe('analyzeEyes: timing', () => {
  it('a slower patient has a larger tracking_lag_s', () => {
    const fast = analyze(run({ latencyMs: 100 }))
    const slow = analyze(run({ latencyMs: 1100 }))
    expect(slow.metrics.tracking_lag_s).toBeGreaterThan(fast.metrics.tracking_lag_s + 0.4)
    expect(slow.flags).toContain('slow to follow the dot')
  })
})

// ---- tolerance for TECHNICAL problems: dropouts, blinks, glitches, sparse cameras, partial protocol -----------------------
const tOf = (f: EyeFrame) => f.face.t - 1000 // ms since the protocol started
const inRange = (f: EyeFrame, from: number, to: number) => tOf(f) >= from && tOf(f) < to
const withoutFrames = (frames: EyeFrame[], pred: (f: EyeFrame, i: number) => boolean) => frames.filter((f, i) => !pred(f, i))
const mapFace = (frames: EyeFrame[], pred: (f: EyeFrame, i: number) => boolean, edit: (face: FaceFrame) => FaceFrame) =>
  frames.map((f, i) => (pred(f, i) ? { ...f, face: edit(f.face) } : f))
const shiftIris = (face: FaceFrame, dx: number): FaceFrame => {
  const lm = face.landmarks.slice()
  lm[468] = { ...lm[468], x: lm[468].x + dx }
  lm[473] = { ...lm[473], x: lm[473].x + dx }
  return { ...face, landmarks: lm }
}
const emptyFace = (face: FaceFrame): FaceFrame => ({ ...face, landmarks: [], blendshapes: {} })

describe('analyzeEyes: dropouts and sparse data are tolerated (partial protocol)', () => {
  it('a short dropout (0.4 s of no face in the middle of the left segment) does not matter', () => {
    const r = analyze(mapFace(run({ noise: 0.01 }), (f) => inRange(f, 1800, 2200), emptyFace))
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBeLessThanOrEqual(0.15)
    expect(r.flags).toContain('eyes followed the dot symmetrically')
  })
  it('30% of frames randomly lost still completes with the same severity', () => {
    const rnd = rng(99)
    const r = analyze(withoutFrames(run({ noise: 0.01 }), () => rnd() + 0.5 < 0.3))
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBeLessThanOrEqual(0.15)
    expect(r.confidence).toBeGreaterThan(MIN_CONFIDENCE)
  })
  it('a slow (about 7 fps) camera still completes', () => {
    const r = analyze(withoutFrames(run({ noise: 0.01 }), (_, i) => i % 4 !== 0))
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBeLessThanOrEqual(0.15)
  })
  it('PARTIAL: the whole LEFT segment lost -> completed on the right side only, flagged, confidence capped', () => {
    const r = analyze(withoutFrames(run({ noise: 0.01 }), (f) => f.target === 'left'))
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBeLessThanOrEqual(0.15)
    expect(r.side).toBe('none')
    expect(r.flags).toContain('only the right side could be measured')
    expect(r.flags).not.toContain('eyes followed the dot symmetrically') // never claims symmetry it did not see
    expect(r.confidence).toBeLessThanOrEqual(EYES_CONFIG.partialConfidenceCap)
    expect(r.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE)
    expect(r.metrics.excursion_asym).toBeUndefined() // not computable with one side
    expect(r.metrics.exc_right).toBeCloseTo(0.1, 1)
  })
  it('PARTIAL with face-not-detected frames (empty landmarks) on the right side works the same', () => {
    const r = analyze(mapFace(run({ noise: 0.01 }), (f) => f.target === 'right', emptyFace))
    expect(r.needsRetry).toBeFalsy()
    expect(r.flags).toContain('only the left side could be measured')
  })
  it('PARTIAL where the measured side was NOT followed is still a finding, not a pass', () => {
    const r = analyze(withoutFrames(run({ ampRightR: 0, ampRightL: 0 }), (f) => f.target === 'left'))
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBe(EYES_CONFIG.notFollowSeverity)
    expect(r.flags).toContain('eyes did not follow the dot to the right')
    expect(r.confidence).toBeLessThanOrEqual(EYES_CONFIG.partialConfidenceCap)
  })
  it('center baseline lost -> retry (there is nothing to measure against)', () => {
    expect(analyze(withoutFrames(run(), (f) => f.target === 'center')).needsRetry).toBe(true)
  })
  it('blinks (blendshape high, iris landmarks garbage) are ignored, not counted as tracking loss', () => {
    const frames = mapFace(
      run({ noise: 0.01 }),
      (_, i) => i % 6 === 0,
      (face) => ({ ...shiftIris(face, 0.03), blendshapes: { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.85 } }),
    )
    const r = analyze(frames)
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBeLessThanOrEqual(0.15)
    expect(r.metrics.frames_blink).toBeGreaterThan(20)
    expect(r.metrics.usable_frac).toBeGreaterThan(0.95)
  })
  it('spiking iris landmarks (every 7th frame jumps) do not move the result', () => {
    const clean = analyze(run({ noise: 0.01 }))
    const r = analyze(mapFace(run({ noise: 0.01 }), (_, i) => i % 7 === 0, (face) => shiftIris(face, 0.008)))
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBeLessThanOrEqual(0.15)
    expect(Math.abs(r.metrics.exc_left - clean.metrics.exc_left)).toBeLessThan(0.03)
  })
  it('a head turned 12 degrees (was rejected at 10) is accepted; 20 is not', () => {
    expect(analyze(run({ yawDeg: 12 })).needsRetry).toBeFalsy()
    expect(analyze(run({ yawDeg: 20 })).needsRetry).toBe(true)
  })
})

describe('analyzeEyes: technical failures name a specific, actionable cause (flags[0])', () => {
  const cause = (frames: EyeFrame[]) => {
    const r = analyze(frames)
    expect(r.needsRetry).toBe(true)
    expect(r.flags[0]).toMatch(/^[^A-Z.]*$/) // lower-case phrase, no period (spoken by the agent)
    return r.flags[0]
  }
  it('face never detected -> lost your eyes: face the screen and add light', () => {
    expect(cause(run().map((f) => ({ ...f, face: emptyFace(f.face) })))).toBe(EYE_MSG.lostEyes)
  })
  it('too few frames -> lost your eyes', () => expect(cause(run().slice(0, 5))).toBe(EYE_MSG.lostEyes))
  it('dark image -> add light', () => {
    const dark = run().map((f) => ({ ...f, face: { ...emptyFace(f.face), brightness: 12 } as FaceFrame }))
    expect(cause(dark)).toBe(EYE_MSG.dark)
  })
  it('head turned in every frame -> keep your head still', () => expect(cause(run({ yawDeg: 22 }))).toBe(EYE_MSG.headTurned))
  it('head turned only while the dot is on the left (turning to look) -> keep your head still, not a partial score', () => {
    expect(cause(mapFace(run(), (f) => f.target === 'left', (face) => ({ ...face, yawDeg: 24 })))).toBe(EYE_MSG.headTurned)
  })
  it('eye geometry glitching in most frames (glasses glare) -> take off glasses; in half of them it is tolerated', () => {
    expect(cause(mapFace(run(), (_, i) => i % 7 !== 0, (face) => shiftIris(face, 0.5)))).toBe(EYE_MSG.glare)
    expect(analyze(mapFace(run(), (_, i) => i % 2 === 0, (face) => shiftIris(face, 0.5))).needsRetry).toBeFalsy()
  })
  it('extremely jittery irises -> retry with an actionable cause', () => {
    expect([EYE_MSG.glare, EYE_MSG.lostEyes]).toContain(cause(run({ noise: 0.3 })))
  })
  it('too far from the camera -> move closer', () => expect(cause(run({ scale: 0.3 }))).toBe(EYE_MSG.tooFar))
  it('gaze moving against the dot -> look at the dot (the labeling hint stays as a detail)', () => {
    const flip = { left: 'right', right: 'left', center: 'center' } as const
    const r = analyze(run().map((f) => ({ ...f, target: flip[f.target] })))
    expect(r.flags[0]).toBe(EYE_MSG.lookAtDot)
    expect(r.flags.join(' ')).toMatch(/opposite/)
  })
})

describe('analyzeEyes: BEHAVIORAL outcomes (eyes tracked fine, but did not follow the dot) are completed results', () => {
  it('eyes never left the center: not a retry, moderate severity, plain flags, confident', () => {
    const r = analyze(run({ amp: 0, noise: 0.01 }))
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBe(EYES_CONFIG.notFollowSeverity)
    expect(r.severity).toBeGreaterThan(0.35) // above the borderline anchor
    expect(r.severity).toBeLessThan(0.85) // below the clear-deficit anchor: conservative, non-diagnostic
    expect(r.confidence).toBeGreaterThan(0.6) // the camera saw the eyes fine
    expect(r.side).toBe('none')
    expect(r.flags).toContain('eyes did not follow the dot to the left')
    expect(r.flags).toContain('eyes did not follow the dot to the right')
    expect(r.flags).not.toContain('eyes followed the dot symmetrically')
    for (const v of Object.values(r.metrics)) expect(Number.isFinite(v)).toBe(true)
  })
  it('a tiny movement (0.035 eye widths) is also "did not follow", not a retry', () => {
    const r = analyze(run({ amp: 0.035, noise: 0.01 }))
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBe(EYES_CONFIG.notFollowSeverity)
  })
  it('one side unfollowed is reported in plain words as well as the asymmetry flag', () => {
    const r = analyze(run({ ampLeftR: 0.005, ampLeftL: 0.005 }))
    expect(r.flags).toContain('eyes did not follow the dot to the left')
    expect(r.flags).toContain('gaze does not reach the left')
    expect(r.flags).not.toContain('eyes did not follow the dot to the right')
  })
  it('a behavioral result feeds the risk score at low weight and can never alert alone', async () => {
    const { computeRisk } = await import('../risk')
    const risk = computeRisk({ eyes: analyze(run({ amp: 0 })) })
    expect(risk.contributions).toHaveLength(1)
    expect(risk.triggered).toBe(false)
  })
  it('eyes fixed on center + very heavy jitter is a technical retry, not a finding', () => {
    expect(analyze(run({ amp: 0, noise: 0.4 })).needsRetry).toBe(true)
  })
})
