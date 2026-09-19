// The real-browser side of the preflight checks. Kept apart from checks.ts so that file stays pure and testable.
// Nothing here opens a camera or microphone: it only queries permissions, lists devices, and loads the (static) models.
import { api } from '../api'
import { queryPermission } from '../media/permissions'
import { FACE_MODEL, POSE_MODEL, WASM_BASE } from '../vision/useMediaPipe'
import type { PreflightEnv } from './checks'

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'))
  } catch {
    return false
  }
}

/** Load the vision runtime and BOTH models (GPU first, CPU as fallback), then close them. No camera involved. */
export async function probeMediaPipe(): Promise<{ delegate: 'GPU' | 'CPU'; ms: number }> {
  const t0 = performance.now()
  const mp = await import('@mediapipe/tasks-vision')
  const fileset = await mp.FilesetResolver.forVisionTasks(WASM_BASE)
  let lastErr: unknown
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      const face = await mp.FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: FACE_MODEL, delegate }, runningMode: 'VIDEO' })
      face.close()
      const pose = await mp.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: POSE_MODEL, delegate }, runningMode: 'VIDEO' })
      pose.close()
      return { delegate, ms: performance.now() - t0 }
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('the models did not load')
}

export function browserPreflightEnv(): PreflightEnv {
  return {
    health: () => api.health(),
    signedUrl: () => api.signedUrl(),
    isSecureContext: () => globalThis.isSecureContext !== false,
    hostname: () => globalThis.location?.hostname ?? '',
    hasGetUserMedia: () => !!navigator.mediaDevices?.getUserMedia,
    hasAudioWorklet: () => typeof AudioWorkletNode !== 'undefined',
    hasWebGL,
    hasWasm: () => typeof WebAssembly === 'object',
    permission: (name) => queryPermission(name),
    countDevices: async (kind) => {
      try {
        const list = await navigator.mediaDevices?.enumerateDevices()
        return list ? list.filter((d) => d.kind === kind).length : null
      } catch {
        return null
      }
    },
    probeMediaPipe,
  }
}
