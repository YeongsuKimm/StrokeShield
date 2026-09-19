// Camera / microphone / location grants for the consent step (docs/spec/06-frontend-ux.md).
// The camera stream itself belongs to the vision engine (lib/vision/useMediaPipe); this module only asks for the
// grant and reports state. Nothing here throws: every failure resolves to 'denied' so the UI can offer a way on.
import type { PermissionKey, PermissionState } from '../session/store'

const PERMISSION_NAMES: Record<PermissionKey, PermissionName> = {
  camera: 'camera' as PermissionName,
  microphone: 'microphone' as PermissionName,
  location: 'geolocation' as PermissionName,
}

/** Current grant without prompting, when the browser supports the Permissions API for it. */
export async function queryPermission(key: PermissionKey): Promise<PermissionState> {
  try {
    const status = await navigator.permissions?.query({ name: PERMISSION_NAMES[key] })
    if (!status) return 'unknown'
    return status.state as PermissionState
  } catch {
    return 'unknown' // Safari/Firefox do not expose camera or microphone here
  }
}

/** Subscribe to later changes (the patient can flip a grant in the address bar mid-session). */
export async function watchPermission(key: PermissionKey, onChange: (s: PermissionState) => void): Promise<() => void> {
  try {
    const status = await navigator.permissions?.query({ name: PERMISSION_NAMES[key] })
    if (!status) return () => {}
    const handler = () => onChange(status.state as PermissionState)
    status.addEventListener('change', handler)
    return () => status.removeEventListener('change', handler)
  } catch {
    return () => {}
  }
}

async function requestStream(constraints: MediaStreamConstraints): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia(constraints)
  } catch (e) {
    console.debug('[permissions] getUserMedia rejected', e)
    return null
  }
}

/**
 * Ask for the camera once so the browser prompt happens on the consent screen rather than mid-test.
 * The track is stopped immediately — the vision engine opens its own stream when a test starts.
 */
export async function requestCamera(): Promise<PermissionState> {
  const stream = await requestStream({ video: true })
  stream?.getTracks().forEach((t) => t.stop())
  return stream ? 'granted' : 'denied'
}

/**
 * Ask for the microphone and KEEP the stream: the mute indicator monitors it for the rest of the session and the
 * speech test records from it. Raw signal (no echo cancellation / noise suppression / AGC) per docs/spec/03-speech.md,
 * so voice-quality features survive.
 */
export async function requestMicrophone(): Promise<{ state: PermissionState; stream: MediaStream | null }> {
  const stream = await requestStream({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  })
  return { state: stream ? 'granted' : 'denied', stream }
}

export interface Fix {
  lat: number
  lng: number
  accuracyM?: number
}

/**
 * Ask at the consent step and cache the fix, so the emergency path never waits on a permission prompt
 * (docs/spec/05-risk-and-alerts.md "Location").
 */
export function requestLocation(timeoutMs = 10_000): Promise<{ state: PermissionState; fix: Fix | null }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ state: 'denied', fix: null })
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          state: 'granted',
          fix: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy },
        }),
      (err) => {
        console.debug('[permissions] geolocation failed', err.code, err.message)
        resolve({ state: 'denied', fix: null })
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    )
  })
}
