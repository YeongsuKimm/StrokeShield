export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

/**
 * Linear ramp: 0 at `lo`, 1 at `hi`, clamped. Works when hi < lo
 * (e.g. "low is bad" features), so pass (normal, abnormal) in that order.
 */
export const ramp = (x: number, lo: number, hi: number): number => clamp01((x - lo) / (hi - lo))

export const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
