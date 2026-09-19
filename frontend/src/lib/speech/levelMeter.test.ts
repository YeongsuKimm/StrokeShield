import { describe, expect, it } from 'vitest'
import { rmsToBar } from './levelMeter'

describe('rmsToBar', () => {
  it('silence and junk are zero', () => {
    for (const v of [0, -1, NaN, 0.0005]) expect(rmsToBar(v)).toBe(0)
  })
  it('a quiet raw-mic speech level (RMS 0.01) is clearly visible, not a sliver', () => {
    expect(rmsToBar(0.01)).toBeGreaterThan(0.45)
  })
  it('is monotonic and capped at 1', () => {
    expect(rmsToBar(0.02)).toBeGreaterThan(rmsToBar(0.01))
    expect(rmsToBar(0.5)).toBe(1)
    expect(rmsToBar(1)).toBe(1)
  })
})
