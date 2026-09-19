import { describe, expect, it } from 'vitest'
import { FACE_CONFIG, analyzeFace } from './face'
import { BORDERLINE, NATURAL_MILD, SYMMETRIC, droopLeft, droopRight, makeCapture, type FaceSpec } from './faceTestUtils'

const run = (spec: FaceSpec) => {
  const { neutral, smile } = makeCapture(spec)
  return analyzeFace(neutral, smile)
}

describe('analyzeFace', () => {
  it('rates a symmetric smile as low severity, confident, no side', () => {
    const r = run(SYMMETRIC)
    expect(r.test).toBe('face')
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBeLessThan(0.15)
    expect(r.confidence).toBeGreaterThan(0.8)
    expect(r.side).toBe('none')
    expect(r.metrics.lift_asym).toBeLessThan(0.15)
    expect(r.metrics.smile_strength).toBeGreaterThan(0.6)
    expect(r.flags).toContain('smile looks symmetric')
  })

  it('detects droop on the patient LEFT (image-right, landmark 291)', () => {
    const r = run(droopLeft())
    expect(r.needsRetry).toBeFalsy()
    expect(r.side).toBe('left')
    expect(r.severity).toBeGreaterThanOrEqual(0.85)
    expect(r.flags).toContain('left mouth corner lifts less')
    expect(r.flags.join(' ')).not.toMatch(/disagree/)
    expect(r.metrics.lift_left).toBeLessThan(r.metrics.lift_right)
  })

  it('detects droop on the patient RIGHT (image-left, landmark 61)', () => {
    const r = run(droopRight())
    expect(r.needsRetry).toBeFalsy()
    expect(r.side).toBe('right')
    expect(r.severity).toBeGreaterThanOrEqual(0.85)
    expect(r.flags).toContain('right mouth corner lifts less')
    expect(r.metrics.lift_right).toBeLessThan(r.metrics.lift_left)
  })

  it('flags a disagreement when blendshape and landmark sides differ', () => {
    const r = run({ ...SYMMETRIC, liftL: 0.02, bsR: 0.15 })
    expect(r.side).toBe('left')
    expect(r.flags.join(' ')).toMatch(/disagree/)
  })

  it('does not misread an eye-aperture-only asymmetry as mouth droop', () => {
    const r = run({ ...SYMMETRIC, squintL: 0.9 })
    expect(r.side).toBe('none')
    expect(r.severity).toBeLessThan(0.15)
    expect(r.flags.join(' ')).toMatch(/left eye opening is narrower/)
  })

  it('is invariant to head roll (20 degrees, both directions)', () => {
    for (const spec of [SYMMETRIC, droopLeft(0.7), droopRight(0.7)]) {
      const base = run(spec)
      for (const rollDeg of [20, -20]) {
        const rolled = run({ ...spec, rollDeg })
        expect(rolled.needsRetry).toBeFalsy()
        expect(rolled.side).toBe(base.side)
        expect(Math.abs(rolled.severity - base.severity)).toBeLessThan(0.05)
        expect(Math.abs(rolled.metrics.lift_asym - base.metrics.lift_asym)).toBeLessThan(0.05)
        expect(Math.abs(rolled.metrics.corner_height_diff - base.metrics.corner_height_diff)).toBeLessThan(0.01)
      }
    }
  })

  it('severity anchors: natural mild asymmetry <= 0.15, borderline 0.3-0.4, clear droop >= 0.85', () => {
    for (const seed of [1, 2, 3]) {
      const natural = run({ ...NATURAL_MILD, seed })
      expect(natural.needsRetry).toBeFalsy()
      expect(natural.severity).toBeLessThanOrEqual(0.15)
      const mild = run({ ...NATURAL_MILD, seed, liftL: NATURAL_MILD.liftR, liftR: NATURAL_MILD.liftL })
      expect(mild.severity).toBeLessThanOrEqual(0.15)
      const border = run({ ...BORDERLINE, seed })
      expect(border.severity).toBeGreaterThanOrEqual(0.3)
      expect(border.severity).toBeLessThanOrEqual(0.4)
      expect(run({ ...droopLeft(), seed }).severity).toBeGreaterThanOrEqual(0.85)
      expect(run({ ...droopRight(), seed }).severity).toBeGreaterThanOrEqual(0.85)
    }
  })

  it('increases severity monotonically as droop increases', () => {
    const levels = [0, 0.2, 0.4, 0.6, 0.8, 1]
    const sev = levels.map((s) => run(droopLeft(s)).severity)
    for (let i = 1; i < sev.length; i++) expect(sev[i]).toBeGreaterThanOrEqual(sev[i - 1])
    expect(sev[sev.length - 1] - sev[0]).toBeGreaterThan(0.6)
  })

  it('needs a retry when the head is yawed 30 degrees', () => {
    const r = run({ ...droopLeft(), yawDeg: 30 })
    expect(r.needsRetry).toBe(true)
    expect(r.severity).toBe(0)
    expect(r.confidence).toBeLessThan(0.3)
    expect(r.flags.join(' ')).toMatch(/head turned away/)
  })

  it('needs a retry when the smile is too weak', () => {
    const r = run({ liftL: 0.01, liftR: 0.01, bsL: 0.15, bsR: 0.15 })
    expect(r.needsRetry).toBe(true)
    expect(r.flags.join(' ')).toMatch(/smile not detected/)
  })

  it('still scores a severe droop where one side barely smiles at all (no false retry)', () => {
    const r = run({ ...SYMMETRIC, liftL: 0, bsL: 0.03, bsR: 0.6 })
    expect(r.needsRetry).toBeFalsy()
    expect(r.side).toBe('left')
    expect(r.severity).toBeGreaterThanOrEqual(0.85)
  })

  it('needs a retry when the patient was already smiling in the neutral capture', () => {
    const { neutral, smile } = makeCapture(SYMMETRIC)
    const smiling = neutral.map((f) => ({ ...f, blendshapes: { mouthSmileLeft: 0.6, mouthSmileRight: 0.6 } }))
    const r = analyzeFace(smiling, smile)
    expect(r.needsRetry).toBe(true)
    expect(r.flags.join(' ')).toMatch(/already smiling/)
  })

  it('needs a retry with too few frames', () => {
    const r = run({ ...droopLeft(), nNeutral: 2, nSmile: 4 })
    expect(r.needsRetry).toBe(true)
    expect(r.flags.join(' ')).toMatch(/not enough frames/)
  })

  it('needs a retry when the face is too small or the room is too dark', () => {
    expect(run({ ...droopLeft(), faceWidth: 0.12 }).needsRetry).toBe(true)
    expect(run({ ...droopLeft(), brightness: 10 }).needsRetry).toBe(true)
  })

  it('needs a retry when landmarks are mirrored (eye line reversed)', () => {
    const { neutral, smile } = makeCapture(droopLeft())
    const mirror = (fs: typeof neutral) =>
      fs.map((f) => ({ ...f, landmarks: f.landmarks.map((p) => ({ ...p, x: 1 - p.x })) }))
    const r = analyzeFace(mirror(neutral), mirror(smile))
    expect(r.needsRetry).toBe(true)
  })

  it('degrades gracefully when the face is missing in many frames', () => {
    const { neutral, smile } = makeCapture(droopLeft())
    const dropped = smile.map((f, i) => (i % 3 === 0 ? { ...f, landmarks: [] } : f))
    const r = analyzeFace(neutral, dropped)
    expect(r.needsRetry).toBeFalsy()
    expect(r.side).toBe('left')
    const mostlyGone = smile.map((f, i) => (i % 5 === 0 ? f : { ...f, landmarks: [] }))
    expect(analyzeFace(neutral, mostlyGone).needsRetry).toBe(true)
  })

  it('does not throw on empty, short or malformed input', () => {
    expect(() => analyzeFace([], [])).not.toThrow()
    const empty = analyzeFace([], [])
    expect(empty.needsRetry).toBe(true)
    expect(empty.test).toBe('face')
    expect(empty.confidence).toBeLessThan(0.3)
    const { neutral, smile } = makeCapture(SYMMETRIC)
    expect(analyzeFace(neutral.slice(0, 1), smile.slice(0, 1)).needsRetry).toBe(true)
    const bad = [{ landmarks: [], blendshapes: {}, t: 0 }]
    expect(analyzeFace(bad, bad).needsRetry).toBe(true)
    const nan = neutral.map((f) => ({ ...f, landmarks: f.landmarks.map(() => ({ x: NaN, y: NaN, z: 0 })) }))
    expect(analyzeFace(nan, smile).needsRetry).toBe(true)
    // @ts-expect-error deliberately wrong input
    expect(() => analyzeFace(undefined, null)).not.toThrow()
  })

  it('fills startedAt and durationMs from the frame timestamps', () => {
    const { neutral, smile } = makeCapture(SYMMETRIC)
    const r = analyzeFace(neutral, smile)
    expect(r.startedAt).toBe(neutral[0].t)
    expect(r.durationMs).toBe(smile[smile.length - 1].t - neutral[0].t)
  })

  it('reports metrics named in the spec and keeps them finite', () => {
    const r = run(droopLeft(0.5))
    for (const k of ['lift_asym', 'smile_bs_asym', 'corner_height_diff', 'eye_aperture_asym', 'smile_strength']) {
      expect(Number.isFinite(r.metrics[k])).toBe(true)
    }
    expect(r.severity).toBeGreaterThanOrEqual(0)
    expect(r.severity).toBeLessThanOrEqual(1)
  })

  it('keeps every metric finite and flags in short lower-case form', () => {
    for (const spec of [SYMMETRIC, droopLeft(), { ...droopRight(), yawDeg: 30 }]) {
      const r = run(spec)
      for (const v of Object.values(r.metrics)) expect(Number.isFinite(v)).toBe(true)
      for (const f of r.flags) expect(f).toMatch(/^[a-z][^.]*[^.]$/)
    }
    const e = analyzeFace([], [])
    for (const f of e.flags) expect(f).toMatch(/^[a-z][^.]*[^.]$/)
  })

  it('has ramp weights that sum to 1', () => {
    const w = Object.values(FACE_CONFIG.ramps).reduce((s, r) => s + r.weight, 0)
    expect(w).toBeCloseTo(1, 6)
  })
})
