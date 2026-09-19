import { describe, expect, it } from 'vitest'
import { auc, cohensD, mean, median, percentile, wilson, Z_95_ONE_SIDED, Z_95_TWO_SIDED } from './stats'

const near = (x: number, y: number, dp = 4): void => expect(x).toBeCloseTo(y, dp)

describe('wilson', () => {
  it('matches the shared spec test vectors', () => {
    near(wilson(0, 60, 1.645).hi, 0.0432)
    near(wilson(0, 20, 1.645).hi, 0.1192)
    const a = wilson(54, 60, 1.96)
    near(a.lo, 0.7985)
    near(a.hi, 0.9534)
    const b = wilson(9, 10, 1.96)
    near(b.lo, 0.5958)
    near(b.hi, 0.9821)
    const c = wilson(60, 60, 1.96)
    near(c.lo, 0.9398)
    near(c.hi, 1)
    expect(c.hi).toBeLessThanOrEqual(1)
  })

  it('clamps to [0,1] and has an exactly 0 lower bound for k = 0', () => {
    const w = wilson(0, 5, 1.96)
    expect(w.lo).toBe(0)
    expect(w.hi).toBeGreaterThan(0)
    expect(w.hi).toBeLessThanOrEqual(1)
  })

  it('n = 0 gives NaN bounds', () => {
    const w = wilson(0, 0, 1.96)
    expect(w.lo).toBeNaN()
    expect(w.hi).toBeNaN()
  })

  it('exposes the two z constants used by the criteria', () => {
    expect(Z_95_ONE_SIDED).toBe(1.645)
    expect(Z_95_TWO_SIDED).toBe(1.96)
  })
})

describe('percentile / median / mean', () => {
  it('interpolates linearly like numpy', () => {
    expect(percentile([1, 2, 3, 4], 0.9)).toBeCloseTo(3.7, 10) // shared spec vector: q is a fraction
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(percentile([1, 2, 3, 4, 5], 0.9)).toBeCloseTo(4.6, 10)
    expect(percentile([1, 2, 3, 4, 5], 0.1)).toBeCloseTo(1.4, 10)
    expect(percentile([7], 0.9)).toBe(7)
    expect(percentile([5, 1, 3], 0)).toBe(1)
    expect(percentile([5, 1, 3], 1)).toBe(5)
  })
  it('handles empty input, NaN and does not mutate its argument', () => {
    expect(percentile([], 0.5)).toBeNaN()
    expect(median([NaN, 4, 2])).toBe(3)
    const v = [3, 1, 2]
    median(v)
    expect(v).toEqual([3, 1, 2])
    expect(mean([1, 2, 3])).toBe(2)
    expect(mean([])).toBeNaN()
  })
})

describe('auc', () => {
  it('is 1 for fully separated, 0 for reversed, 0.5 for ties', () => {
    expect(auc([3, 4], [1, 2])).toBe(1)
    expect(auc([1, 2], [3, 4])).toBe(0)
    expect(auc([1, 1], [1, 1])).toBe(0.5)
    expect(auc([1, 3], [2])).toBe(0.5)
  })
  it('NaN if a group is empty', () => {
    expect(auc([], [1])).toBeNaN()
    expect(auc([1], [])).toBeNaN()
  })
})

describe("cohen's d", () => {
  it('is positive when the first group is higher and matches a hand computation', () => {
    // a: mean 4, var 2.5; b: mean 2, var 2.5 -> pooled sd sqrt(2.5)
    near(cohensD([2, 3, 4, 5, 6], [0, 1, 2, 3, 4]), 2 / Math.sqrt(2.5), 10)
    expect(cohensD([0, 1, 2], [5, 6, 7])).toBeLessThan(0)
  })
  it('NaN when undefined (tiny groups or zero variance)', () => {
    expect(cohensD([1], [1, 2])).toBeNaN()
    expect(cohensD([1, 1], [2, 2])).toBeNaN()
  })
})
