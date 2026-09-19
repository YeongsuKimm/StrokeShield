// OWNER: Vision dev. Spec: docs/spec/02-vision.md
// TODO: implement elevation-angle drift metrics. Keep this a PURE function.
import type { TestResult } from '../contracts'
import type { PoseFrame } from './landmarks'

export function analyzeArms(frames: PoseFrame[]): TestResult {
  const now = Date.now()
  void frames
  return {
    test: 'arms',
    severity: 0,
    confidence: 0,
    metrics: {},
    flags: ['arm analysis not implemented'],
    startedAt: now,
    durationMs: 0,
    needsRetry: true,
  }
}
