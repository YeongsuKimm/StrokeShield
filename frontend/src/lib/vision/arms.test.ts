import { describe, expect, it } from 'vitest'
import type { PoseFrame } from './landmarks'
import { MIN_CONFIDENCE } from '../config'
import { analyzeArms } from './arms'

// ---- synthetic trajectory generator --------------------------------------------------------------------------------
// Geometry: raw (unmirrored) frame. Subject's LEFT (landmark 11/13/15) is on the IMAGE RIGHT (larger x).
// Theta is in degrees, 0 = horizontal, + above. Arm length is in HEIGHT units so angles are true at any aspect ratio.

const ASPECT = 16 / 9
const SHOULDER_W = 0.16 // fraction of frame width
const ARM_LEN = 0.5 // shoulder->wrist, fraction of frame height
const SHOULDER_Y = 0.35

const mulberry32 = (seed: number) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

type Traj = (tSec: number) => number
const steady = (deg = 0): Traj => () => deg
/** Hold at 0 until `from` s, then sink linearly to -`amount` by `to` s and stay. */
const sink =
  (amount: number, from = 1, to = 7): Traj =>
  (t) =>
    -amount * Math.min(1, Math.max(0, (t - from) / (to - from)))

interface Opts {
  fps?: number
  durationMs?: number
  thetaL?: Traj // subject's left arm
  thetaR?: Traj
  noise?: number // landmark jitter, normalized units
  aspect?: number
  t0?: number
  /** Visibility for a joint index at frame i / time t (seconds). */
  vis?: (idx: number, tSec: number) => number
  seed?: number
  swapSides?: boolean // simulate a camera/model that labels the sides the other way around
}

function makeFrames(o: Opts = {}): PoseFrame[] {
  const { fps = 20, durationMs = 10_000, thetaL = steady(), thetaR = steady(), noise = 0.002, aspect = ASPECT } = o
  const rnd = mulberry32(o.seed ?? 1)
  const jit = () => (rnd() - 0.5) * 2 * noise
  const frames: PoseFrame[] = []
  const n = Math.floor((durationMs / 1000) * fps) + 1
  for (let i = 0; i < n; i++) {
    const ms = (i * 1000) / fps
    const tSec = ms / 1000
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }))
    const put = (idx: number, x: number, y: number) => {
      lm[idx] = { x: x + jit(), y: y + jit(), z: 0, visibility: o.vis ? o.vis(idx, tSec) : 0.99 }
    }
    const arm = (sIdx: number, eIdx: number, wIdx: number, sx: number, dir: 1 | -1, thetaDeg: number) => {
      const th = (thetaDeg * Math.PI) / 180
      const dx = (ARM_LEN * Math.cos(th)) / aspect // width fraction
      const dy = ARM_LEN * Math.sin(th) // height fraction, + up
      put(sIdx, sx, SHOULDER_Y)
      put(eIdx, sx + (dir * dx) / 2, SHOULDER_Y - dy / 2)
      put(wIdx, sx + dir * dx, SHOULDER_Y - dy)
    }
    const leftX = 0.5 + SHOULDER_W / 2 // subject's left = image right
    const rightX = 0.5 - SHOULDER_W / 2
    if (o.swapSides) {
      // Labels swapped: what the model calls "left" (11/13/15) is on the image left.
      arm(11, 13, 15, rightX, -1, thetaL(tSec))
      arm(12, 14, 16, leftX, 1, thetaR(tSec))
    } else {
      arm(11, 13, 15, leftX, 1, thetaL(tSec))
      arm(12, 14, 16, rightX, -1, thetaR(tSec))
    }
    frames.push({ landmarks: lm, t: (o.t0 ?? 1_700_000_000_000) + ms })
  }
  return frames
}

// ---- tests ---------------------------------------------------------------------------------------------------------

describe('analyzeArms', () => {
  it('both arms steady -> low severity, no side, confident', () => {
    const r = analyzeArms(makeFrames())
    expect(r.test).toBe('arms')
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBeLessThan(0.15)
    expect(r.side).toBe('none')
    expect(r.confidence).toBeGreaterThan(0.8)
    expect(r.metrics.drift_asym).toBeLessThan(3)
    expect(r.metrics.raised_time_left).toBeGreaterThan(9)
    expect(r.metrics.min_theta_left).toBeGreaterThan(-5)
  })

  it('left arm drops 30 deg -> severe, side left', () => {
    const r = analyzeArms(makeFrames({ thetaL: sink(30) }))
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBeGreaterThanOrEqual(0.85)
    expect(r.side).toBe('left')
    expect(r.metrics.drift_left).toBeGreaterThan(25)
    expect(Math.abs(r.metrics.drift_right)).toBeLessThan(3)
    expect(r.metrics.min_theta_left).toBeLessThan(-25)
    expect(r.metrics.raised_time_left).toBeLessThan(r.metrics.raised_time_right)
    expect(r.flags).toContain('left arm drifted down')
  })

  it('right arm drops 30 deg -> severe, side right', () => {
    const r = analyzeArms(makeFrames({ thetaR: sink(30) }))
    expect(r.severity).toBeGreaterThanOrEqual(0.85)
    expect(r.side).toBe('right')
    expect(r.flags).toContain('right arm drifted down')
  })

  it('both arms drop 20 deg equally -> fatigue: low severity + flag', () => {
    const r = analyzeArms(makeFrames({ thetaL: sink(20), thetaR: sink(20), seed: 7 }))
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBeLessThan(0.15)
    expect(r.flags).toContain('both arms drifted equally')
    expect(r.side).toBe('both')
    expect(r.metrics.drift_left).toBeGreaterThan(15)
    expect(r.metrics.drift_right).toBeGreaterThan(15)
  })

  it('one arm never rises -> severe, names the side, raised_time 0', () => {
    const r = analyzeArms(makeFrames({ thetaL: steady(0), thetaR: steady(-70) }))
    expect(r.needsRetry).toBeFalsy()
    expect(r.severity).toBeGreaterThanOrEqual(0.85)
    expect(r.side).toBe('right')
    expect(r.flags).toContain('right arm never rose')
    expect(r.metrics.raised_time_right).toBe(0)
    expect(r.metrics.raised_time_left).toBeGreaterThan(9)
  })

  it('neither arm raised -> retry (patient probably did not do the test), not a stroke sign', () => {
    const r = analyzeArms(makeFrames({ thetaL: steady(-70), thetaR: steady(-70) }))
    expect(r.needsRetry).toBe(true)
    expect(r.severity).toBe(0)
    expect(r.flags.join(' ')).toContain('neither arm')
  })

  it('a wrist occluded (low visibility) for most of the hold -> needsRetry, no confident guess', () => {
    const r = analyzeArms(makeFrames({ vis: (idx, t) => (idx === 15 && t > 3 ? 0.1 : 0.99) }))
    expect(r.needsRetry).toBe(true)
    expect(r.severity).toBe(0)
    expect(r.confidence).toBeLessThan(MIN_CONFIDENCE)
    expect(r.flags.length).toBeGreaterThan(0)
  })

  it('all joints low visibility -> needsRetry', () => {
    const r = analyzeArms(makeFrames({ vis: () => 0.2 }))
    expect(r.needsRetry).toBe(true)
    expect(r.confidence).toBe(0)
  })

  it('brief occlusion (~10% of frames) is tolerated', () => {
    const r = analyzeArms(makeFrames({ thetaL: sink(30), vis: (idx, t) => (idx === 16 && t > 4 && t < 5 ? 0.1 : 0.99) }))
    expect(r.needsRetry).toBeFalsy()
    expect(r.side).toBe('left')
    expect(r.confidence).toBeGreaterThan(0.6)
  })

  it('a wrist at the frame edge is treated as out of frame -> needsRetry', () => {
    const frames = makeFrames()
    for (const f of frames) f.landmarks[15] = { ...f.landmarks[15], x: 0.995 }
    expect(analyzeArms(frames).needsRetry).toBe(true)
  })

  it('too little time (4 s) -> needsRetry', () => {
    const r = analyzeArms(makeFrames({ durationMs: 4000 }))
    expect(r.needsRetry).toBe(true)
    expect(r.severity).toBe(0)
    expect(r.flags.join(' ')).toContain('not enough data')
  })

  it('too few frames over a long window -> needsRetry', () => {
    const r = analyzeArms(makeFrames({ fps: 2 }))
    expect(r.needsRetry).toBe(true)
  })

  it('shoulders too narrow (patient too far) -> needsRetry', () => {
    const frames = makeFrames()
    // Pull the shoulders together: width < shoulderWidthMin.
    for (const f of frames) {
      f.landmarks[11] = { ...f.landmarks[11], x: 0.54 }
      f.landmarks[12] = { ...f.landmarks[12], x: 0.46 }
    }
    expect(analyzeArms(frames).needsRetry).toBe(true)
  })

  it('severity anchors: natural mild asymmetry <= 0.15, borderline 0.3-0.5, clear >= 0.85', () => {
    // Natural asymmetry: one arm held ~4 deg lower and a little more wobble/drift on one side.
    const natural = analyzeArms(makeFrames({ thetaL: (t) => -4 - 0.3 * t, thetaR: steady(0), seed: 3 }))
    expect(natural.severity).toBeLessThanOrEqual(0.15)
    const borderline = analyzeArms(makeFrames({ thetaL: sink(14) }))
    expect(borderline.severity).toBeGreaterThanOrEqual(0.25)
    expect(borderline.severity).toBeLessThanOrEqual(0.5)
    const clear = analyzeArms(makeFrames({ thetaL: sink(30) }))
    expect(clear.severity).toBeGreaterThanOrEqual(0.85)
    // Fatigue: both arms sink equally, even by a lot.
    const fatigue = analyzeArms(makeFrames({ thetaL: sink(25), thetaR: sink(23), seed: 5 }))
    expect(fatigue.severity).toBeLessThanOrEqual(0.15)
  })

  it('all metrics are finite numbers', () => {
    for (const r of [analyzeArms(makeFrames({ thetaL: sink(30) })), analyzeArms(makeFrames({ durationMs: 4000 })), analyzeArms([])]) {
      for (const v of Object.values(r.metrics)) expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('severity grows monotonically with drift', () => {
    const sev = [0, 10, 20, 30, 40].map((d) => analyzeArms(makeFrames({ thetaL: sink(d) })).severity)
    for (let i = 1; i < sev.length; i++) expect(sev[i]).toBeGreaterThanOrEqual(sev[i - 1])
    expect(sev[3]).toBeGreaterThan(sev[0] + 0.4)
    expect(sev[0]).toBeLessThan(0.15)
  })

  it('mirrored setup (sides swapped) gives mirrored side', () => {
    const a = analyzeArms(makeFrames({ thetaL: sink(30) }))
    const b = analyzeArms(makeFrames({ thetaL: sink(30), swapSides: true }))
    expect(a.side).toBe('left')
    // Same physical image, labels flipped: the failing arm is now on the image-left, i.e. landmark 12-16 side.
    const c = analyzeArms(makeFrames({ thetaR: sink(30), swapSides: true }))
    expect(b.side).toBe('left')
    expect(c.side).toBe('right')
    const mirrorOfA = analyzeArms(makeFrames({ thetaR: sink(30) }))
    expect(mirrorOfA.side).toBe('right')
    expect(mirrorOfA.severity).toBeCloseTo(a.severity, 1)
  })

  it('is insensitive to frame rate (15 vs 30 fps)', () => {
    const a = analyzeArms(makeFrames({ fps: 15, thetaL: sink(30) }))
    const b = analyzeArms(makeFrames({ fps: 30, thetaL: sink(30) }))
    expect(Math.abs(a.metrics.drift_left - b.metrics.drift_left)).toBeLessThan(3)
    expect(Math.abs(a.severity - b.severity)).toBeLessThan(0.1)
  })

  it('uses the aspect ratio to recover true angles (4:3 camera)', () => {
    const frames = makeFrames({ aspect: 4 / 3, thetaL: sink(30) })
    const right = analyzeArms(frames, { aspectRatio: 4 / 3 })
    expect(right.metrics.drift_left).toBeGreaterThan(27)
    expect(right.metrics.drift_left).toBeLessThan(33)
    const wrong = analyzeArms(frames, { aspectRatio: 16 / 9 })
    expect(Math.abs(wrong.metrics.drift_left - right.metrics.drift_left)).toBeGreaterThan(1)
  })

  it('reports drift for a level uneven hold via height_diff', () => {
    const r = analyzeArms(makeFrames({ thetaL: steady(0), thetaR: steady(-25) }))
    expect(r.metrics.height_diff).toBeGreaterThan(0.3)
    expect(r.side).toBe('right') // the lower arm
    expect(r.severity).toBeGreaterThan(0.2)
  })

  it('fills startedAt (epoch ms) / durationMs from frame timestamps', () => {
    // performance.now()-style clock: startedAt is back-computed to wall-clock epoch ms (contracts.ts)
    const before = Date.now()
    const r = analyzeArms(makeFrames({ t0: 5000 }))
    expect(r.durationMs).toBeCloseTo(10_000, -1)
    expect(r.startedAt).toBeGreaterThan(1e11)
    expect(r.startedAt).toBeLessThanOrEqual(before)
    // epoch-like clock: used as is
    const epoch = 1_800_000_000_000
    expect(analyzeArms(makeFrames({ t0: epoch })).startedAt).toBe(epoch)
  })

  it('does not depend on input order', () => {
    const frames = makeFrames({ thetaL: sink(30) })
    const a = analyzeArms(frames)
    const b = analyzeArms([...frames].reverse())
    expect(b.metrics.drift_left).toBe(a.metrics.drift_left)
    expect(b.severity).toBe(a.severity)
  })

  it('does not throw on empty / malformed input', () => {
    expect(() => analyzeArms([])).not.toThrow()
    const r = analyzeArms([])
    expect(r.test).toBe('arms')
    expect(r.needsRetry).toBe(true)
    expect(r.severity).toBe(0)
    const short: PoseFrame[] = Array.from({ length: 300 }, (_, i) => ({ landmarks: [], t: i * 50 }))
    expect(analyzeArms(short).needsRetry).toBe(true)
    const nan: PoseFrame[] = Array.from({ length: 300 }, (_, i) => ({
      landmarks: Array.from({ length: 33 }, () => ({ x: NaN, y: NaN, z: 0, visibility: 1 })),
      t: i * 50,
    }))
    expect(analyzeArms(nan).needsRetry).toBe(true)
    // @ts-expect-error deliberately wrong input
    expect(() => analyzeArms(undefined)).not.toThrow()
  })
})
