import { describe, expect, it } from 'vitest'
import {
  blendshapesToMap,
  buildFaceFrame,
  buildPoseFrame,
  classifyCameraError,
  faceRegion,
  isDebugSearch,
  meanLuminance,
  nextTimestamp,
  toLandmarks,
  yawDegFromMatrix,
} from './frameUtils'

// Column-major 4x4 for a rotation about Y by `deg`, with a translation and uniform scale.
const yawMatrix = (deg: number, scale = 1): number[] => {
  const r = (deg * Math.PI) / 180
  const [c, s] = [Math.cos(r) * scale, Math.sin(r) * scale]
  return [c, 0, -s, 0, 0, scale, 0, 0, s, 0, c, 0, 1.5, -2, -40, 1]
}

describe('yawDegFromMatrix', () => {
  it('is 0 for a frontal face (identity rotation)', () => {
    expect(yawDegFromMatrix(yawMatrix(0))).toBeCloseTo(0, 6)
  })
  it('recovers the rotation angle, independent of scale and translation', () => {
    expect(yawDegFromMatrix(yawMatrix(20))).toBeCloseTo(20, 6)
    expect(yawDegFromMatrix(yawMatrix(-35, 7))).toBeCloseTo(-35, 6)
  })
  it('handles missing or degenerate input', () => {
    expect(yawDegFromMatrix(undefined)).toBeUndefined()
    expect(yawDegFromMatrix([1, 2, 3])).toBeUndefined()
    expect(yawDegFromMatrix(new Array(16).fill(0))).toBeUndefined()
    expect(yawDegFromMatrix(new Array(16).fill(NaN))).toBeUndefined()
  })
  it('accepts typed arrays', () => {
    expect(yawDegFromMatrix(new Float32Array(yawMatrix(10)))).toBeCloseTo(10, 3)
  })
})

describe('blendshapesToMap', () => {
  it('maps category names to scores', () => {
    expect(
      blendshapesToMap([
        { categoryName: 'mouthSmileLeft', score: 0.5 },
        { categoryName: 'mouthSmileRight', score: 0.25 },
      ]),
    ).toEqual({ mouthSmileLeft: 0.5, mouthSmileRight: 0.25 })
  })
  it('tolerates missing input', () => {
    expect(blendshapesToMap(undefined)).toEqual({})
  })
})

describe('meanLuminance', () => {
  it('is 0 for black, 255 for white, and mixes pixels', () => {
    expect(meanLuminance([0, 0, 0, 255])).toBe(0)
    expect(meanLuminance([255, 255, 255, 255])).toBeCloseTo(255, 6)
    expect(meanLuminance([255, 255, 255, 255, 0, 0, 0, 255])).toBeCloseTo(127.5, 6)
  })
  it('weights green most', () => {
    expect(meanLuminance([0, 255, 0, 255])).toBeGreaterThan(meanLuminance([255, 0, 0, 255]))
  })
  it('returns 0 for empty data', () => {
    expect(meanLuminance([])).toBe(0)
  })
})

describe('landmark / frame builders', () => {
  const lm = [{ x: 0.1, y: 0.2, z: -0.3, visibility: 0 }]
  it('drops visibility for face landmarks and keeps it for pose', () => {
    expect(toLandmarks(lm, false)[0]).toEqual({ x: 0.1, y: 0.2, z: -0.3 })
    expect(toLandmarks([{ ...lm[0], visibility: 0.9 }], true)[0].visibility).toBe(0.9)
  })
  it('builds a face frame with blendshapes and yaw', () => {
    const f = buildFaceFrame(
      {
        faceLandmarks: [lm],
        faceBlendshapes: [{ categories: [{ categoryName: 'jawOpen', score: 0.1 }] }],
        facialTransformationMatrixes: [{ data: yawMatrix(12) }],
      },
      1234,
    )
    expect(f?.t).toBe(1234)
    expect(f?.blendshapes).toEqual({ jawOpen: 0.1 })
    expect(f?.yawDeg).toBeCloseTo(12, 6)
    expect(f?.landmarks).toHaveLength(1)
  })
  it('returns null when nothing was detected', () => {
    expect(buildFaceFrame({ faceLandmarks: [] }, 1)).toBeNull()
    expect(buildPoseFrame({ landmarks: [] }, 1)).toBeNull()
  })
  it('builds a pose frame', () => {
    expect(buildPoseFrame({ landmarks: [[{ x: 0.5, y: 0.5, z: 0, visibility: 0.8 }]] }, 5)).toEqual({
      landmarks: [{ x: 0.5, y: 0.5, z: 0, visibility: 0.8 }],
      t: 5,
    })
  })
})

describe('nextTimestamp', () => {
  it('is strictly increasing even if the clock stalls or goes back', () => {
    expect(nextTimestamp(100, 150)).toBe(150)
    expect(nextTimestamp(100, 100)).toBe(101)
    expect(nextTimestamp(100, 90)).toBe(101)
  })
})

describe('classifyCameraError', () => {
  it('maps DOMException names', () => {
    expect(classifyCameraError({ name: 'NotAllowedError' })).toBe('permission-denied')
    expect(classifyCameraError({ name: 'NotFoundError' })).toBe('no-camera')
    expect(classifyCameraError({ name: 'NotReadableError' })).toBe('camera-busy')
    expect(classifyCameraError({ name: 'TypeError' })).toBe('unsupported')
    expect(classifyCameraError(new Error('x'))).toBe('unknown')
    expect(classifyCameraError(null)).toBe('unknown')
  })
})

describe('isDebugSearch', () => {
  it('detects ?debug=1', () => {
    expect(isDebugSearch('?debug=1')).toBe(true)
    expect(isDebugSearch('?demo=1&debug=1')).toBe(true)
    expect(isDebugSearch('?debug=0')).toBe(false)
    expect(isDebugSearch('')).toBe(false)
  })
})

describe('faceRegion (subject-face brightness crop)', () => {
  it('grows the face box, clamps to the frame, and rejects unusable boxes', () => {
    const r = faceRegion({ cx: 0.5, cy: 0.5, size: 0.2 }, 1000, 500)!
    expect(r.sw).toBeCloseTo(250, 3) // 0.2 * 1.25 of the width
    expect(r.sx).toBeCloseTo(375, 3)
    const edge = faceRegion({ cx: 0.98, cy: 0.5, size: 0.3 }, 1000, 500)!
    expect(edge.sx + edge.sw).toBeLessThanOrEqual(1000)
    expect(faceRegion(null, 1000, 500)).toBeNull()
    expect(faceRegion({ cx: 0.5, cy: 0.5, size: 0.005 }, 1000, 500)).toBeNull()
    expect(faceRegion({ cx: 0.5, cy: 0.5, size: 0.2 }, 0, 500)).toBeNull()
  })
})
