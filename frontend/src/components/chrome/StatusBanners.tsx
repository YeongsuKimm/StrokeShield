import { useEffect } from 'react'
import { connectivityOf, useNetwork } from '../../lib/resilience/network'
import { useLifecycle } from '../../lib/resilience/lifecycle'
import { useSession } from '../../lib/session/store'
import { useSpeechProgress } from '../../lib/speech/speechProgressStore'

const pill =
  'pointer-events-auto fixed inset-x-4 top-[4.75rem] z-40 mx-auto max-w-xl rounded-[var(--radius-control)] border px-4 py-3 text-[0.9375rem] leading-snug shadow-[var(--shadow-lift)] sm:top-24'

/**
 * Offline / server-unreachable banner. Says what still works: the camera checks run entirely in the browser, so only
 * the speech analysis, voice guide and alert text need the connection. Call 911 is always the fallback.
 */
export function ConnectivityBanner() {
  const online = useNetwork((s) => s.online)
  const failStreak = useNetwork((s) => s.failStreak)
  const c = connectivityOf({ online, failStreak })
  if (c === 'ok') return null
  return (
    <div role="status" className={`${pill} border-caution/40 bg-caution-wash text-caution`} data-testid="connectivity-banner">
      <p className="font-semibold">{c === 'offline' ? 'You are offline.' : 'Cannot reach the server.'}</p>
      <p className="mt-0.5 text-ink-2">
        The face, arm and eye checks still work. The speech analysis, voice guide and alert text need the connection. If this
        is an emergency, call 911 directly.
      </p>
    </div>
  )
}

/** Shown after a check was paused because the tab went into the background. */
export function ResumeNotice() {
  const interrupted = useLifecycle((s) => s.interrupted)
  const phase = useSession((s) => s.phase)
  const speechRunning = useSpeechProgress((s) => s.running)
  // Recording again (or any later step) ends the notice.
  useEffect(() => {
    if (interrupted === 'speech' && speechRunning) useLifecycle.getState().set(null)
  }, [interrupted, speechRunning])
  // A camera check resumes by itself, so its notice only needs to be seen for a few seconds.
  const resumed = useLifecycle((s) => s.resumed)
  useEffect(() => {
    if (!interrupted || !resumed) return
    const id = setTimeout(() => useLifecycle.getState().set(null), 5000)
    return () => clearTimeout(id)
  }, [interrupted, resumed])
  if (!interrupted || phase !== interrupted) return null
  return (
    <div role="status" className={`${pill} border-line-strong bg-surface text-ink`} data-testid="resume-notice">
      {interrupted === 'speech'
        ? 'Paused while this tab was in the background. Press Start recording when you are ready.'
        : 'Paused while this tab was in the background. Picking the check back up now.'}
    </div>
  )
}
