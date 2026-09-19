// Small pure statistics helpers for validation (Wilson intervals, percentiles, AUC, Cohen's d). No DOM, no fs.
// Shared spec with the Python speech validator: see docs/CALIBRATION.md "Validation".

export const Z_95_TWO_SIDED = 1.96
export const Z_95_ONE_SIDED = 1.645

export interface Interval {
  lo: number
  hi: number
}

/** Wilson score interval for k successes in n trials, clamped to [0, 1]. n = 0 gives NaN bounds. */
export function wilson(k: number, n: number, z: number): Interval {
  if (!(n > 0)) return { lo: NaN, hi: NaN }
  const p = k / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) }
}

/**
 * Percentile with LINEAR INTERPOLATION between closest ranks (numpy default, "type 7"): index = (n - 1) * q, interpolate
 * between floor and ceil. `q` is a FRACTION in 0..1 (0.9 = 90th percentile). NaN for an empty list; non-finite values are ignored.
 */
export function percentile(values: readonly number[], q: number): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (v.length === 0) return NaN
  const pos = Math.min(1, Math.max(0, q)) * (v.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return v[lo] + (v[hi] - v[lo]) * (pos - lo)
}

export const median = (values: readonly number[]): number => percentile(values, 0.5)

export const mean = (values: readonly number[]): number => {
  const v = values.filter(Number.isFinite)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN
}

/** P(a random `positive` value > a random `negative` value), ties count 0.5 (Mann-Whitney AUC). NaN if either is empty. */
export function auc(positive: readonly number[], negative: readonly number[]): number {
  const pos = positive.filter(Number.isFinite)
  const neg = negative.filter(Number.isFinite)
  if (!pos.length || !neg.length) return NaN
  let wins = 0
  for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0
  return wins / (pos.length * neg.length)
}

/** Cohen's d = (mean(a) - mean(b)) / pooled sample SD. NaN if either group has < 2 values or the pooled SD is 0. */
export function cohensD(a: readonly number[], b: readonly number[]): number {
  const x = a.filter(Number.isFinite)
  const y = b.filter(Number.isFinite)
  if (x.length < 2 || y.length < 2) return NaN
  const ss = (v: number[], m: number): number => v.reduce((s, t) => s + (t - m) ** 2, 0)
  const mx = mean(x)
  const my = mean(y)
  const pooled = Math.sqrt((ss(x, mx) + ss(y, my)) / (x.length + y.length - 2))
  return pooled > 0 ? (mx - my) / pooled : NaN
}

/** Number formatting shared by the reports. */
export const fmt = (x: number, dp = 2): string => (Number.isFinite(x) ? x.toFixed(dp) : 'n/a')
export const fmtPct = (x: number, dp = 1): string => (Number.isFinite(x) ? `${(x * 100).toFixed(dp)}%` : 'n/a')
