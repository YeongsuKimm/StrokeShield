// Pure positioning gates: tell the patient to move closer / step back BEFORE a test starts.
// Spec: docs/spec/02-vision.md "Positioning". Thresholds live in config.ts (FRAMING_LIMITS, uncalibrated).
import { FRAMING_LIMITS as L } from '../config'
import { POSE, type Landmark } from './landmarks'

export interface Framing {
  ok: boolean
  hint: string // shown as a caption and can be read by the agent
}

const inFrame = (p: Landmark | undefined): boolean =>
  !!p &&
  (p.visibility ?? 1) >= L.minVisibility &&
  p.x > L.edgeMargin &&
  p.x < 1 - L.edgeMargin &&
  p.y > L.edgeMargin &&
  p.y < 1 - L.edgeMargin

/** Face/eyes/speech tests: patient close to the screen. `face` = 478 face-mesh landmarks (or null if none). */
export function checkFaceFraming(face: Landmark[] | null): Framing {
  if (!face || face.length === 0) return { ok: false, hint: "I can't see your face. Look at the camera." }
  const xs = face.map((p) => p.x)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  if (minX < L.edgeMargin || maxX > 1 - L.edgeMargin) return { ok: false, hint: 'Center your face in the view.' }
  const width = maxX - minX
  if (width < L.faceWidthMin) return { ok: false, hint: 'Move a little closer to the screen.' }
  if (width > L.faceWidthMax) return { ok: false, hint: 'Move back a little.' }
  return { ok: true, hint: 'Good. Hold still.' }
}

/** Arms test: patient stepped back so both shoulders, elbows and hands are in frame. `pose` = 33 BlazePose landmarks. */
export function checkArmFraming(pose: Landmark[] | null): Framing {
  const need = [POSE.shoulderL, POSE.shoulderR, POSE.elbowL, POSE.elbowR, POSE.wristL, POSE.wristR]
  if (!pose || pose.length === 0) return { ok: false, hint: 'Step back until I can see your upper body and both hands.' }
  if (!need.every((i) => inFrame(pose[i]))) {
    return { ok: false, hint: 'Step back until I can see both hands and both shoulders.' }
  }
  const shoulderWidth = Math.abs(pose[POSE.shoulderL].x - pose[POSE.shoulderR].x)
  if (shoulderWidth < L.shoulderWidthMin) return { ok: false, hint: 'Move a little closer.' }
  return { ok: true, hint: 'Good. Get ready to raise your arms.' }
}
