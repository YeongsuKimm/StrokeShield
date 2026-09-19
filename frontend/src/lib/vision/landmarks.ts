export interface Landmark {
  x: number // normalized 0..1, RAW (unmirrored) image coordinates
  y: number
  z: number
  visibility?: number
}

/** One frame of face-landmarker output. */
export interface FaceFrame {
  landmarks: Landmark[] // 478 points
  blendshapes: Record<string, number> // e.g. mouthSmileLeft
  yawDeg?: number // from facial transformation matrix
  t: number // ms timestamp
}

/** One frame of pose-landmarker output. */
export interface PoseFrame {
  landmarks: Landmark[] // 33 BlazePose points
  t: number
}

// Face Mesh indices (verify left/right with the debug overlay, then record the mapping here).
export const FACE = { mouthA: 61, mouthB: 291, noseTip: 1, eyeOuterA: 33, eyeOuterB: 263 } as const
// BlazePose indices
export const POSE = { shoulderL: 11, shoulderR: 12, elbowL: 13, elbowR: 14, wristL: 15, wristR: 16 } as const
