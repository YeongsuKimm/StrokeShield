import { describe, expect, it } from 'vitest'
import { checkArmFraming, checkFaceFraming } from './framing'
import { POSE, type Landmark } from './landmarks'

const face = (cx: number, width: number): Landmark[] => [
  { x: cx - width / 2, y: 0.3, z: 0 },
  { x: cx + width / 2, y: 0.6, z: 0 },
  { x: cx, y: 0.45, z: 0 },
]

const pose = (over: Partial<Record<number, Partial<Landmark>>> = {}): Landmark[] => {
  const p: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }))
  const set = (i: number, x: number, y: number) => (p[i] = { x, y, z: 0, visibility: 1, ...over[i] })
  set(POSE.shoulderL, 0.45, 0.4)
  set(POSE.shoulderR, 0.55, 0.4)
  set(POSE.elbowL, 0.35, 0.4)
  set(POSE.elbowR, 0.65, 0.4)
  set(POSE.wristL, 0.25, 0.4)
  set(POSE.wristR, 0.75, 0.4)
  return p
}

describe('checkFaceFraming', () => {
  it('accepts a face of sensible size', () => expect(checkFaceFraming(face(0.5, 0.3)).ok).toBe(true))
  it('asks to move closer when small', () => expect(checkFaceFraming(face(0.5, 0.1)).hint).toMatch(/closer/))
  it('asks to move back when huge', () => expect(checkFaceFraming(face(0.5, 0.7)).hint).toMatch(/back/))
  it('asks to center when at the edge', () => expect(checkFaceFraming(face(0.1, 0.3)).hint).toMatch(/Center/))
  it('handles no face', () => expect(checkFaceFraming(null).ok).toBe(false))
})

describe('checkArmFraming', () => {
  it('accepts when both hands and shoulders are visible', () => expect(checkArmFraming(pose()).ok).toBe(true))
  it('tells the patient to step back when a wrist is out of frame', () => {
    const r = checkArmFraming(pose({ [POSE.wristR]: { x: 1.05 } }))
    expect(r.ok).toBe(false)
    expect(r.hint).toMatch(/Step back/)
  })
  it('tells the patient to step back when a wrist is not visible', () => {
    expect(checkArmFraming(pose({ [POSE.wristL]: { visibility: 0.1 } })).ok).toBe(false)
  })
  it('asks to come closer when too far away', () => {
    const r = checkArmFraming(pose({ [POSE.shoulderL]: { x: 0.48 }, [POSE.shoulderR]: { x: 0.52 } }))
    expect(r.hint).toMatch(/closer/)
  })
  it('handles no pose', () => expect(checkArmFraming(null).ok).toBe(false))
})
