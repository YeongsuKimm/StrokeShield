// Cross-test consistency: face, arms and eyes are built independently but feed ONE risk score, so they must agree on
// conventions (retry semantics, timestamps, scales) and on what severity means. If one of these fails, a module drifted.
import { describe, expect, it } from 'vitest'
import { FRAMING_LIMITS, MAX_WEIGHTS, MIN_CONFIDENCE } from '../config'
import type { TestName, TestResult } from '../contracts'
import { computeRisk } from '../risk'
import { ARMS_CONFIG, analyzeArms } from './arms'
import { analyzeEyes, EYES_CONFIG } from './eyes'
import { analyzeFace, FACE_CONFIG } from './face'

const empties: [TestName, () => TestResult][] = [
  ['face', () => analyzeFace([], [])],
  ['arms', () => analyzeArms([])],
  ['eyes', () => analyzeEyes([])],
]

describe('retry contract (no usable data)', () => {
  it.each(empties)('%s returns a clean retry result', (test, run) => {
    const r = run()
    expect(r.test).toBe(test)
    expect(r.needsRetry).toBe(true)
    expect(r.severity).toBe(0)
    expect(r.confidence).toBeLessThan(MIN_CONFIDENCE) // so the risk score excludes it
    expect(r.flags.length).toBeGreaterThan(0)
    expect(r.flags[0]).toMatch(/^[^A-Z.]*$/) // short lower-case phrase, no trailing period (spoken by the agent)
    for (const v of Object.values(r.metrics)) expect(Number.isFinite(v)).toBe(true)
    expect(r.startedAt).toBeGreaterThan(1e11) // epoch ms per contracts.ts
    expect(Number.isFinite(r.durationMs)).toBe(true)
  })

  it('retry results never contribute to the risk score', () => {
    const results = Object.fromEntries(empties.map(([t, run]) => [t, run()]))
    const risk = computeRisk(results)
    expect(risk.contributions).toHaveLength(0)
    expect(risk.triggered).toBe(false)
  })

  it('does not throw on garbage frames', () => {
    const junk = [{ landmarks: [], blendshapes: {}, t: NaN }] as never
    expect(() => analyzeFace(junk, junk)).not.toThrow()
    expect(() => analyzeArms([{ landmarks: [], t: 0 }, { t: NaN }] as never)).not.toThrow()
    expect(() => analyzeEyes([{ face: { landmarks: [], blendshapes: {}, t: 0 }, target: 'left' }])).not.toThrow()
  })
})

describe('shared scales and defaults', () => {
  it('uses the same default video aspect ratio (16:9) everywhere', () => {
    expect(FACE_CONFIG.defaultAspect).toBe(ARMS_CONFIG.defaultAspectRatio)
    expect(EYES_CONFIG).toBeDefined()
  })

  it('uses the same face-width confidence scale in face and eyes', () => {
    expect(EYES_CONFIG.confidence.faceWidth.lo).toBe(FACE_CONFIG.faceWidthZero)
    expect(EYES_CONFIG.confidence.faceWidth.hi).toBe(FACE_CONFIG.faceWidthFull)
  })

  it('a face that passes the framing gate is not rejected by the face-width confidence', () => {
    expect(FRAMING_LIMITS.faceWidthMin).toBeGreaterThanOrEqual(FACE_CONFIG.faceWidthZero)
  })

  it('eyes is stricter on head yaw than the face test (eyes reject, face degrades softly)', () => {
    expect(EYES_CONFIG.maxYawDeg).toBeLessThanOrEqual(FACE_CONFIG.yawFullDeg)
  })
})

// Severity anchors every module is calibrated to (healthy <= 0.15, borderline ~0.35, clear >= 0.85).
// These scenarios pin what those anchors MEAN once weighted by MAX_WEIGHTS in the noisy-OR risk score.
const res = (test: TestName, severity: number, confidence = 1): TestResult => ({
  test,
  severity,
  confidence,
  metrics: {},
  flags: [],
  startedAt: 0,
  durationMs: 0,
})
const HEALTHY = 0.15
const BORDERLINE = 0.35
const CLEAR = 0.9

describe('risk outcomes at the shared severity anchors', () => {
  it('healthy people with natural asymmetry never come close to alerting', () => {
    const r = computeRisk({ face: res('face', HEALTHY), arms: res('arms', HEALTHY), speech: res('speech', HEALTHY), eyes: res('eyes', HEALTHY) })
    expect(r.triggered).toBe(false)
    expect(r.risk).toBeLessThan(0.3)
  })

  it('a clear one-sided face deficit alone triggers', () => {
    expect(computeRisk({ face: res('face', CLEAR) }).triggered).toBe(true)
  })

  it('a clear one-sided arm deficit alone triggers', () => {
    expect(computeRisk({ arms: res('arms', CLEAR) }).triggered).toBe(true)
  })

  it('a clear eyes deficit alone does NOT trigger (eyes only corroborates)', () => {
    expect(MAX_WEIGHTS.eyes).toBeLessThan(0.5)
    expect(computeRisk({ eyes: res('eyes', 1) }).triggered).toBe(false)
  })

  it('a borderline result on a single test never triggers', () => {
    for (const t of ['face', 'arms', 'speech', 'eyes'] as const) {
      expect(computeRisk({ [t]: res(t, BORDERLINE) }).triggered).toBe(false)
    }
  })

  it('a clear deficit plus corroboration triggers more surely than either alone', () => {
    const alone = computeRisk({ face: res('face', CLEAR) }).risk
    const withEyes = computeRisk({ face: res('face', CLEAR), eyes: res('eyes', CLEAR) }).risk
    expect(withEyes).toBeGreaterThan(alone)
  })

  it('OPEN DECISION (docs/STATUS.md): speech weight 0.5 means a clear speech-only deficit stays just under the threshold', () => {
    // Face/arms alone trigger at severity >= ~0.85 (weight 0.6); speech (weight 0.5) needs severity 1.0 alone.
    // If the team wants "any one FAST sign triggers", raise MAX_WEIGHTS.speech to 0.6 and update this test.
    expect(computeRisk({ speech: res('speech', CLEAR) }).triggered).toBe(false)
  })
})
