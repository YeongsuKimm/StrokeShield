// Demo PREFLIGHT: one screen that says, before the judges arrive, whether this laptop + network can run the demo.
// Every check is a small async function over an injected environment, returns green / amber / red with a one-line fix,
// and NEVER throws or hangs (each is raced against a timeout). Nothing is captured, recorded or stored: the camera and
// microphone are only *enumerated* and their permission *queried*; no stream is ever opened. Backend readiness uses
// a secret-free boolean snapshot; no voice conversation or alert is started.
import type { HealthResponse } from '../contracts'
import type { PreflightResponse } from '../api'

export type CheckStatus = 'ok' | 'warn' | 'fail'

export interface CheckResult {
  status: CheckStatus
  /** What was found, one line. */
  detail: string
  /** What to do about it, one line. Empty for green rows. */
  fix: string
}

export interface CheckDef {
  id: string
  label: string
  run: () => Promise<CheckResult>
}

/** Everything the checks need from the outside world, so tests can fake a browser. */
export interface PreflightEnv {
  health: () => Promise<HealthResponse>
  preflight: () => Promise<PreflightResponse>
  isSecureContext: () => boolean
  hostname: () => string
  hasGetUserMedia: () => boolean
  hasAudioWorklet: () => boolean
  hasWebGL: () => boolean
  hasWasm: () => boolean
  permission: (name: 'camera' | 'microphone') => Promise<'granted' | 'denied' | 'prompt' | 'unknown'>
  countDevices: (kind: 'videoinput' | 'audioinput') => Promise<number | null>
  /** Load the vision runtime + models and report which delegate worked. Throws with a short reason if it cannot. */
  probeMediaPipe: () => Promise<{ delegate: 'GPU' | 'CPU'; ms: number }>
}

const fmtErr = (e: unknown): string => {
  const m = (e as { message?: string } | null)?.message
  return m && m.length < 140 ? m : 'no answer'
}

export const CHECK_TIMEOUT_MS = 20_000

/** Race a check against a timeout and turn any throw into a red row. Exported for tests. */
export async function guarded(run: () => Promise<CheckResult>, timeoutMs: number, timeoutFix: string): Promise<CheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      run(),
      new Promise<CheckResult>((resolve) => {
        timer = setTimeout(() => resolve({ status: 'fail', detail: 'Timed out.', fix: timeoutFix }), timeoutMs)
      }),
    ])
  } catch (e) {
    return { status: 'fail', detail: `Check crashed: ${fmtErr(e)}`, fix: timeoutFix }
  } finally {
    clearTimeout(timer)
  }
}

export function buildChecks(env: PreflightEnv): CheckDef[] {
  const mediaCheck = (kind: 'camera' | 'microphone'): (() => Promise<CheckResult>) => async () => {
    const label = kind === 'camera' ? 'camera' : 'microphone'
    if (!env.isSecureContext()) {
      return { status: 'fail', detail: `The browser hides the ${label} on this address.`, fix: 'Open the app over https:// or http://localhost.' }
    }
    if (!env.hasGetUserMedia()) {
      return { status: 'fail', detail: 'This browser cannot use the camera or microphone.', fix: 'Use a current Chrome, Edge, Safari or Firefox.' }
    }
    const [perm, count] = await Promise.all([env.permission(kind), env.countDevices(kind === 'camera' ? 'videoinput' : 'audioinput')])
    if (perm === 'denied') {
      return { status: 'fail', detail: `${label[0].toUpperCase()}${label.slice(1)} is blocked for this site.`, fix: 'Click the lock icon in the address bar and allow it, then reload.' }
    }
    if (count === 0) {
      return { status: 'fail', detail: `No ${label} found.`, fix: `Plug in a ${label}, or close other apps that may be holding it.` }
    }
    const devices = count === null ? 'device list unavailable' : `${count} device${count === 1 ? '' : 's'}`
    if (perm === 'granted') return { status: 'ok', detail: `Allowed, ${devices}.`, fix: '' }
    return {
      status: 'warn',
      detail: `Not asked yet (${devices}).`,
      fix: 'Fine: the browser will ask at the consent step. To avoid a prompt on stage, run the check once beforehand and choose Allow.',
    }
  }

  return [
    {
      id: 'secure',
      label: 'Secure context (HTTPS or localhost)',
      run: async () =>
        env.isSecureContext()
          ? { status: 'ok', detail: `Secure (${env.hostname() || 'unknown host'}).`, fix: '' }
          : { status: 'fail', detail: 'Not a secure context: camera, microphone and location are blocked.', fix: 'Serve the app over https:// (Vercel) or open http://localhost:5173.' },
    },
    {
      id: 'browser',
      label: 'Browser support',
      run: async () => {
        const missing = [
          !env.hasGetUserMedia() && 'camera/microphone access (getUserMedia)',
          !env.hasAudioWorklet() && 'AudioWorklet (speech recording)',
          !env.hasWebGL() && 'WebGL (fast face tracking)',
          !env.hasWasm() && 'WebAssembly (face and pose models)',
        ].filter((m): m is string => typeof m === 'string')
        if (missing.length === 0) return { status: 'ok', detail: 'getUserMedia, AudioWorklet, WebGL and WebAssembly all present.', fix: '' }
        const fatal = missing.some((m) => !m.startsWith('WebGL'))
        return {
          status: fatal ? 'fail' : 'warn',
          detail: `Missing: ${missing.join(', ')}.`,
          fix: fatal ? 'Use a current desktop Chrome or Edge.' : 'Face tracking will fall back to the slower CPU path; a current Chrome or Edge is best.',
        }
      },
    },
    {
      id: 'backend',
      label: 'Backend /api/health',
      run: async () => {
        let h: HealthResponse
        try {
          h = await env.health()
        } catch (e) {
          return {
            status: 'fail',
            detail: fmtErr(e),
            fix: 'Start the backend (uvicorn backend.main:app --port 8000) or check VITE_API_BASE_URL. Face, arm and eye checks still work; speech, voice guide and alerts will not.',
          }
        }
        if (h.ok !== true) return { status: 'fail', detail: 'The backend answered but says it is not OK.', fix: 'Check the backend logs.' }
        const mode = h.dryRun ? 'DRY RUN, no real texts' : 'LIVE, real texts armed'
        const parts = `${mode}${h.demoMode ? ', demo mode' : ''}`
        return h.dryRun
          ? { status: 'ok', detail: `Reachable. ${parts}.`, fix: '' }
          : { status: 'warn', detail: `Reachable. ${parts}.`, fix: 'Live: a real text goes to the demo phone. Set DRY_RUN=true in .env for rehearsals.' }
      },
    },
    { id: 'camera', label: 'Camera', run: mediaCheck('camera') },
    { id: 'microphone', label: 'Microphone', run: mediaCheck('microphone') },
    {
      id: 'mediapipe',
      label: 'Face and pose models (MediaPipe)',
      run: async () => {
        try {
          const r = await env.probeMediaPipe()
          return r.delegate === 'GPU'
            ? { status: 'ok', detail: `Models and WASM loaded in ${Math.round(r.ms)} ms, GPU delegate.`, fix: '' }
            : { status: 'warn', detail: `Models and WASM loaded in ${Math.round(r.ms)} ms, CPU delegate (slower).`, fix: 'Works, but frame rate is lower. Enable hardware acceleration in the browser settings for the GPU path.' }
        } catch (e) {
          return { status: 'fail', detail: `Could not load: ${fmtErr(e)}`, fix: 'Run pnpm install (copies the WASM) and check frontend/public/models/*.task exist, then reload.' }
        }
      },
    },
    {
      id: 'live-services',
      label: 'Live alerts and voice guides',
      run: async () => {
        try {
          const r = await env.preflight()
          const providerReady = r.alertChannel === 'email_sms' ? r.smtpConfigured : r.twilioConfigured
          const alertReady = r.gatewayValid && (r.dryRun || providerReady)
          const missing = [!alertReady && 'live alert', !r.agentConfigured && 'English guide', !r.agentConfiguredEs && 'Spanish guide'].filter(Boolean)
          if (missing.length) {
            return {
              status: 'fail',
              detail: `Not ready: ${missing.join(', ')}.`,
              fix: 'Check DEMO_PHONE_NUMBER, alert credentials, ELEVENLABS_API_KEY and both agent IDs in .env.',
            }
          }
          const alert = r.dryRun ? 'alerts are dry-run' : `${r.alertChannel} alerts are live`
          return { status: 'ok', detail: `Both language guides are configured; ${alert}.`, fix: '' }
        } catch (e) {
          return { status: 'fail', detail: fmtErr(e), fix: 'Check the backend and the alert and ElevenLabs settings in .env.' }
        }
      },
    },
  ]
}

/** Run every check (in parallel), publishing each row as it lands. Never rejects. */
export async function runPreflight(
  checks: CheckDef[],
  onRow: (id: string, r: CheckResult | 'running') => void,
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<Record<string, CheckResult>> {
  const out: Record<string, CheckResult> = {}
  await Promise.all(
    checks.map(async (c) => {
      onRow(c.id, 'running')
      const r = await guarded(c.run, timeoutMs, 'Try again; if it keeps failing, reload the page.')
      out[c.id] = r
      onRow(c.id, r)
    }),
  )
  return out
}

/** Worst status wins: any red = "not ready", any amber = "ready with caveats". */
export function overall(results: Record<string, CheckResult>): CheckStatus | 'pending' {
  const all = Object.values(results)
  if (all.length === 0) return 'pending'
  if (all.some((r) => r.status === 'fail')) return 'fail'
  if (all.some((r) => r.status === 'warn')) return 'warn'
  return 'ok'
}
