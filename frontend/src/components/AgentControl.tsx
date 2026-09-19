import { useEffect, useState } from 'react'
import { ConversationProvider } from '@elevenlabs/react'
import { guideStartProblemText } from '../lib/media/permissions'
import { useAgent } from '../lib/agent/useAgent'
import { VOICE_CONSENT_TEXT } from '../lib/privacy/consentText'
import { useSession } from '../lib/session/store'

// Lives in its own lazy chunk (with the ElevenLabs SDK, the heaviest dependency): the checks never need it, so it must
// not delay the first paint. See App.tsx, which loads it behind a Suspense + error boundary.

function AgentControl() {
  const { start, end, status } = useAgent()
  const connected = status === 'connected'
  const connecting = status === 'connecting'
  // The guide streams microphone audio to ElevenLabs, so it has its own opt-in, asked here at the point of use.
  const voiceConsent = useSession((s) => s.voiceConsent)
  const setVoiceConsent = useSession((s) => s.setVoiceConsent)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState<string | null>(null)
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
    <div className="fixed bottom-5 right-5 z-40 flex items-center gap-3 rounded-full border border-line bg-surface p-1.5 shadow-[var(--shadow-lift)] sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-7 sm:-translate-x-1/2 sm:px-4 sm:py-2">
      <span className="sr-only text-[0.875rem] text-ink-2 sm:not-sr-only" role="status">
        {connected ? 'Guide is listening' : connecting ? 'Connecting…' : 'Voice guide'}
      </span>
      <button
        type="button"
        onClick={() => (connected ? finish() : voiceConsent ? run() : setAsking((v) => !v))}
        disabled={connecting}
        className="rounded-full bg-ink px-4 py-2 text-[0.875rem] font-semibold text-paper transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {connected ? 'End guide' : 'Start guide'}
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
          aria-label="Voice guide consent"
          className="absolute bottom-full right-0 mb-3 w-[min(20rem,calc(100vw-2.5rem))] rounded-[var(--radius-panel)] border border-line-strong bg-surface p-4 shadow-[var(--shadow-lift)] sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-full sm:mb-0 sm:mt-3 sm:-translate-x-1/2"
        >
          <p className="text-[0.9375rem] leading-snug text-ink-2">{VOICE_CONSENT_TEXT}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={begin} className="rounded-full bg-ink px-4 py-2 text-[0.875rem] font-semibold text-paper hover:opacity-80">
              Allow and start
            </button>
            <button type="button" onClick={() => setAsking(false)} className="rounded-full border border-line-strong px-4 py-2 text-[0.875rem] font-semibold text-ink hover:bg-sunken">
              Not now
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
