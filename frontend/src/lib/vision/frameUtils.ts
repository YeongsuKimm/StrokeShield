// PURE helpers for the live-camera runtime (no DOM, no MediaPipe import): unit-tested in frameUtils.test.ts.
// All landmarks stay in RAW (unmirrored) image coordinates. Only the draw layer mirrors.
import type { FaceFrame, Landmark, PoseFrame } from './landmarks'

/** Structural subset of MediaPipe's NormalizedLandmark. */
export interface RawLandmark {
  x: number
  y: number
  z: number
  visibility?: number
}

/** Structural subset of MediaPipe's Category (blendshape score). */
export interface RawCategory {
  categoryName: string
  score: number
}

const RAD2DEG = 180 / Math.PI

/**
 * Head yaw in degrees from MediaPipe's facial transformation matrix (4x4, `data` flattened COLUMN-MAJOR).
 * We take the face's forward axis (third column: data[8], data[9], data[10]) and measure its angle from the camera
 * axis in the horizontal plane: yaw = atan2(fx, |fz|). 0 = facing the camera; roll and pitch don't leak in much.
 * The perspective/scale in the matrix cancels out. |z| makes it robust to a z-sign convention, so the result is in
 * [-90, 90]. SIGN IS UNVERIFIED on a live camera (only |yaw| is used by the confidence gates). Returns undefined
 * when the matrix is missing/degenerate.
 */
export function yawDegFromMatrix(data: ArrayLike<number> | undefined | null): number | undefined {
  if (!data || data.length < 11) return undefined
  const fx = data[8]
  const fz = data[10]
  if (!Number.isFinite(fx) || !Number.isFinite(fz) || (fx === 0 && fz === 0)) return undefined
  return Math.atan2(fx, Math.abs(fz)) * RAD2DEG
}

/** Blendshape categories -> { mouthSmileLeft: 0.42, ... }. */
export function blendshapesToMap(categories: readonly RawCategory[] | undefined | null): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of categories ?? []) out[c.categoryName] = c.score
  return out
}

/**
 * Mean luminance (Rec. 709 luma) of RGBA pixel data, on a 0..255 scale (the scale `FaceCaptureFrame.brightness` uses).
 * Returns 0 for empty input.
 */
export function meanLuminance(rgba: ArrayLike<number>): number {
  const n = Math.floor(rgba.length / 4)
  if (n === 0) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const o = i * 4
    sum += 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2]
  }
  return sum / n
}

/** Copy MediaPipe landmarks into plain objects. Face landmarks carry no real visibility (MediaPipe returns 0), so drop it. */
export function toLandmarks(list: readonly RawLandmark[], keepVisibility: boolean): Landmark[] {
  return list.map((p) => (keepVisibility ? { x: p.x, y: p.y, z: p.z, visibility: p.visibility } : { x: p.x, y: p.y, z: p.z }))
}

/** One face-landmarker result (structural subset) -> FaceFrame, or null when no face was detected. */
export function buildFaceFrame(
  result: {
    faceLandmarks: readonly (readonly RawLandmark[])[]
    faceBlendshapes?: readonly { categories: readonly RawCategory[] }[]
    facialTransformationMatrixes?: readonly { data: ArrayLike<number> }[]
  },
  t: number,
): FaceFrame | null {
  const lm = result.faceLandmarks[0]
  if (!lm || lm.length === 0) return null
  return {
    landmarks: toLandmarks(lm, false),
    blendshapes: blendshapesToMap(result.faceBlendshapes?.[0]?.categories),
    yawDeg: yawDegFromMatrix(result.facialTransformationMatrixes?.[0]?.data),
    t,
  }
}

/** One pose-landmarker result -> PoseFrame, or null when no person was detected. */
export function buildPoseFrame(result: { landmarks: readonly (readonly RawLandmark[])[] }, t: number): PoseFrame | null {
  const lm = result.landmarks[0]
  if (!lm || lm.length === 0) return null
  return { landmarks: toLandmarks(lm, true), t }
}

/** detectForVideo needs strictly increasing timestamps. */
export const nextTimestamp = (prev: number, now: number): number => (now > prev ? now : prev + 1)

export type CameraErrorKind = 'permission-denied' | 'no-camera' | 'camera-busy' | 'unsupported' | 'unknown'

/** Map a getUserMedia failure to a typed kind the UI can show. */
export function classifyCameraError(e: unknown): CameraErrorKind {
  const name = (e as { name?: string } | null)?.name
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'permission-denied'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no-camera'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'camera-busy'
    case 'TypeError':
      return 'unsupported'
    default:
      return 'unknown'
  }
}

export const CAMERA_ERROR_TEXT: Record<CameraErrorKind, string> = {
  'permission-denied': 'Camera access is blocked. Click the lock icon in the address bar, set Camera to Allow, then reload this page.',
  'no-camera': 'No camera was found on this device.',
  'camera-busy': 'The camera is in use by another app or tab.',
  unsupported: 'This browser cannot open the camera (needs HTTPS or localhost).',
  unknown: 'Could not start the camera.',
}

/** The camera stopped while a check was running (permission revoked, unplugged, or taken by another app). */
export const CAMERA_ENDED_TEXT = 'The camera stopped. It may have been unplugged, blocked in the address bar (lock icon), or taken by another app.'

/** `?debug=1` toggles the landmark-index / left-right debug overlay. */
export const isDebugSearch = (search: string): boolean => new URLSearchParams(search).get('debug') === '1'
