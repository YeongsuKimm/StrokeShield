// OWNER: Vision dev. Spec: docs/spec/02-vision.md
// TODO: implement roll-corrected mouth-corner lift asymmetry etc. Keep this a PURE function.
import type { TestResult } from '../contracts'
import type { FaceFrame } from './landmarks'

export function analyzeFace(neutral: FaceFrame[], smile: FaceFrame[]): TestResult {
  const now = Date.now()
  void neutral
  void smile
  return {
    test: 'face',
    severity: 0,
    confidence: 0,
    metrics: {},
    flags: ['face analysis not implemented'],
    startedAt: now,
    durationMs: 0,
    needsRetry: true,
  }
}
