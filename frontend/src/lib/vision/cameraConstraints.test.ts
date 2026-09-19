import { describe, expect, it } from 'vitest'
import { cameraConstraints } from './useMediaPipe'

describe('cameraConstraints', () => {
  it('asks a phone for a PORTRAIT 3:4 stream: the arm span has to fit across the frame', () => {
    const c = cameraConstraints(true)
    const w = (c.width as { ideal: number }).ideal
    const h = (c.height as { ideal: number }).ideal
    expect(w).toBeLessThan(h) // portrait
    expect(w / h).toBeCloseTo(0.75, 2) // 3:4, the widest view a phone gives in portrait
  })

  it('caps the phone frame rate so two models fit in the budget', () => {
    expect((cameraConstraints(true).frameRate as { max: number }).max).toBeLessThanOrEqual(30)
  })

  it('leaves desktop on 16:9 with no frame-rate cap', () => {
    const c = cameraConstraints(false)
    const w = (c.width as { ideal: number }).ideal
    const h = (c.height as { ideal: number }).ideal
    expect(w / h).toBeCloseTo(16 / 9, 2)
    expect(c.frameRate).toBeUndefined()
  })

  it('always uses the front camera', () => {
    for (const mobile of [true, false]) expect(cameraConstraints(mobile).facingMode).toBe('user')
  })
})
