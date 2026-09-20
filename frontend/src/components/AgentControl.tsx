import { useEffect, useRef, useState } from 'react'
import { ConversationProvider } from '@elevenlabs/react'
import { guideStartProblemText } from '../lib/media/permissions'
import { useAgent } from '../lib/agent/useAgent'
import { VOICE_CONSENT_TEXT } from '../lib/privacy/consentText'
import { useSession } from '../lib/session/store'
import { pick, useLocale } from '../lib/i18n'

// Lives in its own lazy chunk (with the ElevenLabs SDK, the heaviest dependency): the checks never need it, so it must
// not delay the first paint. See App.tsx, which loads it behind a Suspense + error boundary.

function AgentControl() {
  const locale = useLocale((s) => s.locale)
  const { start, end, status } = useAgent()
  const connected = status === 'connected'
  const connecting = status === 'connecting'
  // The guide streams microphone audio to ElevenLabs, so it has its own opt-in, asked here at the point of use.
  const voiceConsent = useSession((s) => s.voiceConsent)
  const setVoiceConsent = useSession((s) => s.setVoiceConsent)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const startRef = useRef<HTMLButtonElement>(null)
  // A blocked microphone, no device or a failed signed-URL request must say so, not fail silently.
  const run = () => {
    setNote(null)
    start().catch((e: unknown) => {
      console.debug('[agent] start failed', (e as { name?: string } | null)?.name)
      setVoiceConsent(false)
      setNote(guideStartProblemText(e))
    })
  }
  const begin = () => {
    setAsking(false)
    setVoiceConsent(true)
    run()
  }
  // Escape closes the consent prompt and hands focus back to the button that opened it.
  useEffect(() => {
    if (!asking) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setAsking(false)
      startRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [asking])
  // However the session ended (button, dropped socket, Clear my data), the opt-in ends with it.
  useEffect(() => {
    if (status === 'disconnected') setVoiceConsent(false)
  }, [status, setVoiceConsent])
  const finish = () => {
    setVoiceConsent(false) // ending the guide withdraws the opt-in; the next start asks again
    void end()
  }

  return (
    // Top-centre from `sm` up. On a phone the header already fills the top edge (brand + menu), so the control
    // sits bottom-right instead (opposite the Call 911 button), with the status text kept for screen readers only.
    <div className="fixed bottom-[calc(1.25rem+var(--safe-b))] right-5 z-40 flex items-center gap-3 rounded-full border border-line bg-surface p-1.5 shadow-[var(--shadow-lift)] sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-7 sm:-translate-x-1/2 sm:px-4 sm:py-2">
      <span className="sr-only text-[0.875rem] text-ink sm:not-sr-only" role="status">
        {connected ? pick(locale, 'Guide is listening', 'La gu\u00eda est\u00e1 escuchando') : connecting ? pick(locale, 'Connecting\u2026', 'Conectando\u2026') : pick(locale, 'Voice guide', 'Gu\u00eda de voz')}
      </span>
      <button
        ref={startRef}
        type="button"
        onClick={() => (connected ? finish() : voiceConsent ? run() : setAsking((v) => !v))}
        disabled={connecting}
        aria-expanded={connected ? undefined : asking}
        className="min-h-11 rounded-full bg-ink px-4 py-2 text-[0.875rem] font-semibold text-paper transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {connected ? pick(locale, 'End guide', 'Finalizar gu\u00eda') : pick(locale, 'Start guide', 'Iniciar gu\u00eda')}
      </button>
      {note && !connected && !connecting && !asking && (
        <p
          role="alert"
          className="absolute bottom-full right-0 mb-3 w-[min(20rem,calc(100vw-2.5rem))] rounded-[var(--radius-panel)] border border-line-strong bg-surface p-4 text-[0.9375rem] leading-snug text-danger shadow-[var(--shadow-lift)] sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-full sm:mb-0 sm:mt-3 sm:-translate-x-1/2"
        >
          {note}
        </p>
      )}
      {asking && !connected && (
        <div
          role="group"
          aria-label={pick(locale, 'Voice guide consent', 'Consentimiento para la gu\u00eda de voz')}
          className="absolute bottom-full right-0 mb-3 w-[min(20rem,calc(100vw-2.5rem))] rounded-[var(--radius-panel)] border border-line-strong bg-surface p-4 shadow-[var(--shadow-lift)] sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-full sm:mb-0 sm:mt-3 sm:-translate-x-1/2"
        >
          <p className="text-[0.9375rem] leading-snug text-ink-2">{pick(locale, VOICE_CONSENT_TEXT, 'La gu\u00eda de voz transmite el audio de tu micr\u00f3fono a ElevenLabs mientras est\u00e9 activa. ElevenLabs puede conservar el audio y la transcripci\u00f3n seg\u00fan su pol\u00edtica de privacidad.')}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={begin} className="min-h-11 rounded-full bg-ink px-4 py-2 text-[0.875rem] font-semibold text-paper hover:opacity-80">
              {pick(locale, 'Allow and start', 'Permitir e iniciar')}
            </button>
            <button type="button" onClick={() => setAsking(false)} className="min-h-11 rounded-full border border-control-edge px-4 py-2 text-[0.875rem] font-semibold text-ink hover:bg-sunken">
              {pick(locale, 'Not now', 'Ahora no')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AgentDock() {
  return (
    <ConversationProvider>
      <AgentControl />
    </ConversationProvider>
  )
}
