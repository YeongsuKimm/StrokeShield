// Eyes test stimulus protocol (pure; no DOM). Spec: docs/spec/02-vision.md "Eyes test".
// 'left' / 'right' are ALWAYS the PATIENT's own left/right (see EyeFrame in eyes.ts).
import type { FaceFrame } from './landmarks'

export type EyeTarget = 'center' | 'left' | 'right'

/** Dot sequence: center 1 s -> left 2 s -> center 1 s -> right 2 s -> center 1 s. */
export const EYE_PROTOCOL: ReadonlyArray<{ target: EyeTarget; ms: number }> = [
  { target: 'center', ms: 1000 },
  { target: 'left', ms: 2000 },
  { target: 'center', ms: 1000 },
  { target: 'right', ms: 2000 },
  { target: 'center', ms: 1000 },
]

export const EYE_PROTOCOL_TOTAL_MS: number = EYE_PROTOCOL.reduce((s, p) => s + p.ms, 0)

/** Where the dot should be `elapsedMs` after the protocol started. Before start / after end -> 'center'. */
export function targetAt(elapsedMs: number): EyeTarget {
  if (!(elapsedMs >= 0)) return 'center'
  let end = 0
  for (const step of EYE_PROTOCOL) {
    end += step.ms
    if (elapsedMs < end) return step.target
  }
  return 'center'
}

/**
 * Convenience for live integration: label raw face frames with the protocol target, given the timestamp (same clock
 * as `FaceFrame.t`) at which the protocol started. Frames outside the protocol window are dropped.
 */
export function labelEyeFrames(
  faces: FaceFrame[],
  protocolStartT: number,
): Array<{ face: FaceFrame; target: EyeTarget }> {
  return faces
    .filter((f) => f.t >= protocolStartT && f.t - protocolStartT < EYE_PROTOCOL_TOTAL_MS)
    .map((face) => ({ face, target: targetAt(face.t - protocolStartT) }))
}
