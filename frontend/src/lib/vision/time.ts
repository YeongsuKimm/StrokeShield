/**
 * TestResult.startedAt must be epoch ms (contracts.ts). Frame timestamps `t` are normally performance.now()-style,
 * so only trust `t0` as wall-clock time when it looks like epoch ms; otherwise back-compute from `now`.
 * Shared by face/arms/eyes so all three results carry comparable timestamps.
 */
export const epochStartedAt = (t0: number | undefined, durationMs: number, now: number = Date.now()): number =>
  t0 !== undefined && Number.isFinite(t0) && t0 > 1e11 ? t0 : now - durationMs
