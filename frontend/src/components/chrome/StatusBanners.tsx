import { useEffect, useState } from 'react'
import { currentBrowser } from '../../lib/preflight/browserSupport'
import { connectivityOf, useNetwork } from '../../lib/resilience/network'
import { useLifecycle } from '../../lib/resilience/lifecycle'
import { useSession } from '../../lib/session/store'
import { useSpeechProgress } from '../../lib/speech/speechProgressStore'
import { pick, useLocale } from '../../lib/i18n'

const pill =
  'pointer-events-auto fixed inset-x-4 top-[4.75rem] z-40 mx-auto max-w-xl rounded-[var(--radius-control)] border px-4 py-3 text-[0.9375rem] leading-snug shadow-[var(--shadow-lift)] sm:top-24'

/**
 * Offline / server-unreachable banner. Says what still works: the camera checks run entirely in the browser, so only
 * the speech analysis, voice guide and alert text need the connection. Call 911 is always the fallback.
 */
export function ConnectivityBanner() {
  const locale = useLocale((s) => s.locale)
  const online = useNetwork((s) => s.online)
  const failStreak = useNetwork((s) => s.failStreak)
  const c = connectivityOf({ online, failStreak })
  if (c === 'ok') return null
  return (
    <div role="status" className={`${pill} border-caution/40 bg-caution-wash text-caution`} data-testid="connectivity-banner">
      <p className="font-semibold">{c === 'offline' ? pick(locale, 'You are offline.', 'No tienes conexi\u00f3n.') : pick(locale, 'Cannot reach the server.', 'No se puede contactar al servidor.')}</p>
      <p className="mt-0.5 text-ink-2">
        {pick(locale, 'The face, arm and eye checks still work. The speech analysis, voice guide and alert text need the connection. If this is an emergency, call 911 directly.', 'Las revisiones de cara, brazos y ojos siguen funcionando. El an\u00e1lisis del habla, la gu\u00eda de voz y el mensaje de alerta necesitan conexi\u00f3n. Si es una emergencia, llama directamente al 911.')}
      </p>
    </div>
  )
}

/** Shown after a check was paused because the tab went into the background. */
export function ResumeNotice() {
  const locale = useLocale((s) => s.locale)
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
        ? pick(locale, 'Paused while this tab was in the background. Press Start recording when you are ready.', 'Se paus\u00f3 mientras esta pesta\u00f1a estaba en segundo plano. Pulsa Empezar a grabar cuando est\u00e9s listo.')
        : pick(locale, 'Paused while this tab was in the background. Picking the check back up now.', 'Se paus\u00f3 mientras esta pesta\u00f1a estaba en segundo plano. Reanudando la revisi\u00f3n.')}
    </div>
  )
}

/**
 * The browser itself cannot run the check. Only two cases are worth interrupting someone for:
 *
 * - **In-app browser** (the web view inside Instagram, TikTok, a chat app): several block camera access outright, so
 *   the check would fail with no explanation. Not dismissible, because nothing here will work until they move.
 * - **An engine we have not tested** (Firefox and the rest): everything may well work, so this is one quiet,
 *   dismissible line, never a block. Telling someone who may be having a stroke "unsupported browser" and stopping
 *   there would be the worst outcome of all.
 */
export function BrowserBanner() {
  const [browser] = useState(currentBrowser)
  const [dismissed, setDismissed] = useState(false)
  if (browser.verdict === 'supported' || dismissed) return null

  if (browser.verdict === 'in-app') {
    const how = browser.ios ? 'Tap the ⋯ or compass icon, then “Open in Safari”.' : 'Tap the ⋮ menu, then “Open in browser”.'
    return (
      <div role="alert" className={`${pill} border-danger/40 bg-danger-wash text-danger`} data-testid="browser-banner">
        <p className="font-semibold">The camera cannot start inside {browser.host ?? 'this app'}.</p>
        <p className="mt-0.5 text-ink-2">
          {how} Then run the check there. In an emergency, call 911 directly.
        </p>
      </div>
    )
  }

  return (
    <div role="status" className={`${pill} flex items-start gap-3 border-line-strong bg-surface text-ink`} data-testid="browser-banner">
      <p className="min-w-0 flex-1 text-ink-2">
        <span className="font-semibold text-ink">This browser has not been tested.</span> The check should still work. If
        the camera or microphone will not start, try Safari or Chrome.
      </p>
      <button type="button" onClick={() => setDismissed(true)} className="shrink-0 font-semibold text-accent underline underline-offset-2">
        Got it
      </button>
    </div>
  )
}
