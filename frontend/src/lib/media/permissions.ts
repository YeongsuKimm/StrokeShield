// Camera / microphone / location grants for the consent step (docs/spec/06-frontend-ux.md).
// The camera stream itself belongs to the vision engine (lib/vision/useMediaPipe); this module only asks for the
// grant and reports state. Nothing here throws or hangs: every failure resolves to a state plus a typed `problem`
// so the UI can say what to do next (lock icon, close the other app, plug a device in) instead of a bare "Blocked".
import type { PermissionKey, PermissionState } from '../session/store'

const PERMISSION_NAMES: Record<PermissionKey, PermissionName> = {
  camera: 'camera' as PermissionName,
  microphone: 'microphone' as PermissionName,
  location: 'geolocation' as PermissionName,
}

/** Why a grant did not succeed. `denied` is the only one that needs the lock icon; the rest are retryable. */
export type PermissionProblem =
  | 'denied' // the visitor (or a remembered choice) said no
  | 'dismissed' // the prompt closed / never answered, so nothing was decided
  | 'no-device' // NotFoundError / OverconstrainedError
  | 'busy' // NotReadableError: another app or tab holds the device
  | 'insecure' // not HTTPS / localhost: browsers hide these APIs
  | 'unsupported' // API missing
  | 'unavailable' // geolocation: allowed, but the device cannot work out where it is
  | 'timeout' // geolocation: allowed, but no fix in time
  | 'unknown'

export interface GrantResult {
  state: PermissionState
  problem: PermissionProblem | null
}

/** camera/mic/geolocation only exist in a secure context (HTTPS or localhost). Unknown (old runtimes, tests) counts as fine. */
export const isInsecureContext = (): boolean => (globalThis as { isSecureContext?: boolean }).isSecureContext === false

/** How long a prompt may stay unanswered before the UI stops saying "waiting" (a dismissed Firefox prompt never rejects). */
export const PROMPT_WAIT_MS = 45_000

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

/** Map a getUserMedia rejection to a problem. NotAllowedError is split into denied/dismissed by the caller. */
export function classifyGrantError(e: unknown): PermissionProblem {
  switch ((e as { name?: string } | null)?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'denied'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no-device'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy'
    case 'TypeError':
      return 'unsupported'
    default:
      return 'unknown'
  }
}

type StreamOutcome = { stream: MediaStream } | { problem: PermissionProblem; state: PermissionState }

async function requestStream(key: 'camera' | 'microphone', constraints: MediaStreamConstraints, waitMs: number): Promise<StreamOutcome> {
  if (isInsecureContext()) return { problem: 'insecure', state: 'unknown' }
  if (!navigator.mediaDevices?.getUserMedia) return { problem: 'unsupported', state: 'unknown' }
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const pending = navigator.mediaDevices.getUserMedia(constraints).then(
    (stream): StreamOutcome | 'timeout' => {
      if (timedOut) {
        stream.getTracks().forEach((t) => t.stop()) // answered after we gave up waiting: do not leak an open device
        return 'timeout'
      }
      return { stream }
    },
    (e): StreamOutcome => ({ problem: classifyGrantError(e), state: 'unknown' }),
  )
  const gaveUp = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true
      resolve('timeout')
    }, waitMs)
  })
  const outcome = await Promise.race([pending, gaveUp])
  clearTimeout(timer)
  if (outcome === 'timeout') return { problem: 'dismissed', state: 'prompt' }
  if ('stream' in outcome) return outcome
  console.debug('[permissions] getUserMedia rejected', key, outcome.problem)
  if (outcome.problem !== 'denied') return outcome
  // "denied" covers both an explicit Block and a prompt closed with the X. Chrome keeps the state at 'prompt' in the
  // second case; there is nothing to fix in the browser settings, the visitor just has to answer.
  return (await queryPermission(key)) === 'prompt' ? { problem: 'dismissed', state: 'prompt' } : { problem: 'denied', state: 'denied' }
}

/**
 * Ask for the camera once so the browser prompt happens on the consent screen rather than mid-test.
 * The track is stopped immediately — the vision engine opens its own stream when a test starts.
 */
export async function requestCamera(waitMs = PROMPT_WAIT_MS): Promise<GrantResult> {
  const out = await requestStream('camera', { video: true }, waitMs)
  if ('stream' in out) {
    out.stream.getTracks().forEach((t) => t.stop())
    return { state: 'granted', problem: null }
  }
  return out
}

/**
 * Ask for the microphone and KEEP the stream: the mute indicator monitors it for the rest of the session and the
 * speech test records from it. Raw signal (no echo cancellation / noise suppression / AGC) per docs/spec/03-speech.md,
 * so voice-quality features survive.
 */
export async function requestMicrophone(waitMs = PROMPT_WAIT_MS): Promise<GrantResult & { stream: MediaStream | null }> {
  const out = await requestStream(
    'microphone',
    { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } },
    waitMs,
  )
  if ('stream' in out) return { state: 'granted', problem: null, stream: out.stream }
  return { ...out, stream: null }
}

/** Calls `onEnded` once when a device track stops by itself (permission revoked, unplugged, taken by another app). */
export function watchTracksEnded(stream: MediaStream, onEnded: () => void): () => void {
  let fired = false
  const handler = () => {
    if (fired) return
    fired = true
    onEnded()
  }
  const tracks = stream.getTracks()
  tracks.forEach((t) => t.addEventListener('ended', handler))
  return () => tracks.forEach((t) => t.removeEventListener('ended', handler))
}

// ---------------------------------------------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------------------------------------------

export interface Fix {
  lat: number
  lng: number
  accuracyM?: number
}

/**
 * Validate and limit precision before a fix is stored or sent: lat/lng must be finite and in range (the backend
 * `Location` schema rejects the WHOLE alert with 422 otherwise, and JSON turns NaN into null), rounded to 5 decimals
 * (~1 m, finer than any GPS fix) and accuracy to whole metres.
 */
export function sanitizeFix(fix: Fix | null | undefined): Fix | null {
  if (!fix) return null
  const { lat, lng, accuracyM } = fix
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  const out: Fix = { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 }
  if (typeof accuracyM === 'number' && Number.isFinite(accuracyM) && accuracyM >= 0) out.accuracyM = Math.round(accuracyM)
  return out
}

type PositionOutcome =
  | { ok: true; fix: Fix }
  | { ok: false; reason: 'denied' | 'unavailable' | 'timeout' | 'no-answer' | 'unsupported' | 'insecure' | 'unknown' }

interface PositionOptions {
  /** Passed to the browser. Chrome starts this clock only AFTER the visitor answers the prompt. */
  timeoutMs: number
  maximumAgeMs: number
  highAccuracy: boolean
  /** Our own cap, so a prompt nobody answers (Firefox "X") or a stuck provider cannot hang the caller forever. */
  hardCapMs: number
}

function getPosition(o: PositionOptions): Promise<PositionOutcome> {
  return new Promise((resolve) => {
    if (isInsecureContext()) return resolve({ ok: false, reason: 'insecure' })
    const geo = typeof navigator === 'undefined' ? undefined : navigator.geolocation
    if (!geo) return resolve({ ok: false, reason: 'unsupported' })
    let done = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (r: PositionOutcome) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(r)
    }
    timer = setTimeout(() => finish({ ok: false, reason: 'no-answer' }), o.hardCapMs)
    try {
      geo.getCurrentPosition(
        (pos) => {
          const fix = sanitizeFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy })
          finish(fix ? { ok: true, fix } : { ok: false, reason: 'unavailable' })
        },
        (err) => {
          // Code and message only: never the position. (1 denied, 2 unavailable, 3 timeout.)
          console.debug('[permissions] geolocation failed', err?.code, err?.message)
          finish({ ok: false, reason: err?.code === 1 ? 'denied' : err?.code === 2 ? 'unavailable' : err?.code === 3 ? 'timeout' : 'unknown' })
        },
        { enableHighAccuracy: o.highAccuracy, timeout: o.timeoutMs, maximumAge: o.maximumAgeMs },
      )
    } catch (e) {
      console.debug('[permissions] geolocation threw', (e as { name?: string } | null)?.name)
      finish({ ok: false, reason: 'unknown' })
    }
  })
}

/**
 * Ask at the consent step (from the visitor's click on Allow) and cache the fix, so the emergency path never waits on
 * a permission prompt (docs/spec/05-risk-and-alerts.md "Location"). First try is high accuracy (a phone's GPS beats
 * a cell tower for a map link); if that times out or is unavailable, one coarse retry accepts a fix up to 5 minutes old.
 */
export async function requestLocation(
  timeoutMs = 10_000,
  hardCapMs = PROMPT_WAIT_MS,
): Promise<GrantResult & { fix: Fix | null }> {
  let r = await getPosition({ timeoutMs, maximumAgeMs: 30_000, highAccuracy: true, hardCapMs })
  if (!r.ok && (r.reason === 'timeout' || r.reason === 'unavailable')) {
    r = await getPosition({ timeoutMs: 8_000, maximumAgeMs: 300_000, highAccuracy: false, hardCapMs: 10_000 })
  }
  if (r.ok) return { state: 'granted', problem: null, fix: r.fix }
  switch (r.reason) {
    case 'denied':
      return { state: 'denied', problem: 'denied', fix: null }
    case 'no-answer':
      return { state: 'prompt', problem: 'dismissed', fix: null }
    case 'insecure':
    case 'unsupported':
      return { state: 'unknown', problem: r.reason, fix: null }
    default: {
      // Allowed but no fix (indoors, GPS off, slow provider): the permission itself is fine, say so.
      const q = await queryPermission('location')
      return { state: q === 'unknown' ? 'prompt' : q, problem: r.reason, fix: null }
    }
  }
}

/** The alert never waits longer than this for a location refresh. */
export const ALERT_LOCATION_CAP_MS = 3_000

/**
 * The location to put in the alert. NEVER prompts and never waits past `capMs`: it only refreshes when the browser
 * already says location is granted (a second, cheap read accepting a fix up to 2 minutes old), and otherwise, or on
 * any failure, falls back to the fix cached at the consent step. A location the visitor has since revoked is dropped.
 */
export async function locationForAlert(cached: Fix | null | undefined, capMs = ALERT_LOCATION_CAP_MS): Promise<Fix | undefined> {
  const fallback = sanitizeFix(cached) ?? undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const attempt = (async (): Promise<Fix | undefined> => {
      const state = await queryPermission('location')
      if (state === 'denied') return undefined
      if (state !== 'granted') return fallback // 'prompt' would open a dialog in an emergency; 'unknown' cannot be checked
      const r = await getPosition({ timeoutMs: capMs, maximumAgeMs: 120_000, highAccuracy: true, hardCapMs: capMs })
      return r.ok ? r.fix : fallback
    })()
    const cap = new Promise<Fix | undefined>((resolve) => {
      timer = setTimeout(() => resolve(fallback), capMs + 250)
    })
    return await Promise.race([attempt, cap])
  } catch {
    return fallback
  } finally {
    clearTimeout(timer)
  }
}

/** Actionable text for a failed grant. `denied` names the lock icon; the others say what to fix. */
export function problemText(key: PermissionKey, problem: PermissionProblem): string {
  switch (problem) {
    case 'denied':
      return key === 'location'
        ? 'Blocked. This is optional: the text will say location unavailable. To allow it, click the lock icon in the address bar, set Location to Allow, then reload.'
        : `Blocked. Click the lock icon in the address bar, set ${key === 'camera' ? 'Camera' : 'Microphone'} to Allow, then reload this page. You can also skip a check that needs it.`
    case 'dismissed':
      return 'The browser asked but no choice was made. Press the button again and choose Allow.'
    case 'no-device':
      return `No ${key} was found. Plug one in or turn it on, then try again.`
    case 'busy':
      return `The ${key} would not start. Another app or browser tab may be using it. Close that and try again.`
    case 'insecure':
      return 'This page is not on HTTPS or localhost, so the browser hides the camera, microphone and location. Open the https:// address.'
    case 'unsupported':
      return `This browser cannot use the ${key}. Try a current Chrome, Edge, Safari or Firefox.`
    case 'unavailable':
      return 'Allowed, but this device could not work out where you are. The text will say location unavailable.'
    case 'timeout':
      return 'Allowed, but finding you took too long. Try again, or skip it: the text will say location unavailable.'
    default:
      return `Could not switch on the ${key}. Try again.`
  }
}

/** Text for a voice-guide start failure (its own microphone request, or the signed-URL call). Never throws. */
export function guideStartProblemText(e: unknown): string {
  const p = classifyGrantError(e)
  if (p === 'denied') return 'The voice guide needs the microphone and it is blocked. Click the lock icon in the address bar, set Microphone to Allow, then reload and try again. The checks work without the guide.'
  if (p === 'no-device') return 'No microphone was found for the voice guide. Plug one in and try again. The checks work without the guide.'
  if (p === 'busy') return 'The microphone would not start for the voice guide. Another app or tab may be using it. The checks work without the guide.'
  return 'The voice guide could not start. Check your connection and that the microphone is allowed, then try again. The checks work without the guide.'
}
