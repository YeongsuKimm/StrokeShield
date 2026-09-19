import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CountdownModal } from './components/CountdownModal'
import { DemoPanel } from './components/DemoPanel'
import { RecordPanel } from './components/RecordPanel'
import { EmergencyButton } from './components/chrome/EmergencyButton'
import { SiteHeader } from './components/chrome/SiteHeader'
import { HomePage } from './components/pages/HomePage'
import { InfoPage } from './components/pages/InfoPage'
import { ResultScreen } from './components/result/ResultScreen'
import { Disclaimer } from './components/ui/Disclaimer'
import { ArmsTest } from './components/test/ArmsTest'
import { EyeTest } from './components/test/EyeTest'
import { FaceTest } from './components/test/FaceTest'
import { SpeechTest } from './components/test/SpeechTest'
import { SpeechRecordPanel } from './components/SpeechRecordPanel'
import { sendAlertForSession } from './lib/alertFlow'
import { consumePendingAnchor } from './lib/anchorTarget'
import { guideStartProblemText } from './lib/media/permissions'
import { isSpeechRecordSearch } from './lib/calibration/recorder'
import { useSession, isResultPhase } from './lib/session/store'
import { ConversationProvider } from '@elevenlabs/react'
import { useAgent } from './lib/agent/useAgent'
import { VOICE_CONSENT_TEXT } from './lib/privacy/consentText'
import { pageTitle } from './lib/a11y/pageTitle'
import { markAppReady } from './lib/a11y/useA11y'
import { testSequence } from './lib/config'

function AgentControl() {
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
    <div
      className="fixed bottom-5 right-5 z-40 flex items-center gap-3 rounded-full border border-line bg-surface p-1.5 shadow-[var(--shadow-lift)] sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-7 sm:-translate-x-1/2 sm:px-4 sm:py-2"
    >
      <span className="sr-only text-[0.875rem] text-ink-2 sm:not-sr-only" role="status">
        {connected ? 'Guide is listening' : connecting ? 'Connecting…' : 'Voice guide'}
      </span>
      <button
        ref={startRef}
        type="button"
        onClick={() => (connected ? finish() : voiceConsent ? run() : setAsking((v) => !v))}
        disabled={connecting}
        aria-expanded={connected ? undefined : asking}
        className="min-h-11 rounded-full bg-ink px-4 py-2 text-[0.875rem] font-semibold text-paper transition-opacity hover:opacity-80 disabled:opacity-50"
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
            <button type="button" onClick={begin} className="min-h-11 rounded-full bg-ink px-4 py-2 text-[0.875rem] font-semibold text-paper hover:opacity-80">
              Allow and start
            </button>
            <button type="button" onClick={() => setAsking(false)} className="min-h-11 rounded-full border border-control-edge px-4 py-2 text-[0.875rem] font-semibold text-ink hover:bg-sunken">
              Not now
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Sends the alert when the store enters alerting+sending: countdown expiry, or the one retry after a failure
 * (`retryAlert`). The backend decides the destination number, never this client (lib/alertFlow.ts).
 */
function useAlertOnExpiry() {
  const phase = useSession((s) => s.phase)
  const alertStatus = useSession((s) => s.alertStatus)
  useEffect(() => {
    if (phase === 'alerting' && alertStatus === 'sending') void sendAlertForSession()
  }, [phase, alertStatus])
}

/** Shift+D turns on the demo panel mid-session, as well as ?demo=1 (docs/spec/06). */
function useDemoHotkey() {
  const setDemoEnabled = useSession((s) => s.setDemoEnabled)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Plain Shift+D only: Ctrl/Cmd+Shift+D is the browser's own "bookmark all tabs", and typing a capital D in
      // a field must not toggle the panel.
      const t = e.target as HTMLElement | null
      const typing = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'D' || e.key === 'd') && !typing) {
        setDemoEnabled(!useSession.getState().demoEnabled)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [setDemoEnabled])
}

/** `route` is a PROP, not read from the store: the page that is fading out must stay what it was, or it would
 *  re-render as the destination page mid-exit and flash it before the transition. */
function CurrentScreen({ route }: { route: 'home' | 'info' }) {
  const phase = useSession((s) => s.phase)

  if (route === 'info') return <InfoPage />
  if (isResultPhase(phase)) return <ResultScreen />

  switch (phase) {
    case 'speech':
      return <SpeechTest />
    case 'eyes':
      return <EyeTest />
    case 'face':
      return <FaceTest />
    case 'arms':
      return <ArmsTest />
    default:
      return <HomePage />
  }
}

function AppContent() {
  const phase = useSession((s) => s.phase)
  const route = useSession((s) => s.route)
  const demoEnabled = useSession((s) => s.demoEnabled)
  // A unique <title> for every screen (WCAG 2.4.2); focus moves to each screen's heading (lib/a11y/useA11y.ts).
  useEffect(() => {
    document.title = pageTitle(route, phase, testSequence())
  }, [route, phase])
  useEffect(markAppReady, [])
  useAlertOnExpiry()
  useDemoHotkey()

  // Home <-> info is a soft hand-off, not a cut: the old page eases out in the direction of travel (down to info =
  // content moves up), then the new page eases in from the far side. Direction follows the destination.
  const reduce = useReducedMotion()
  const dir = route === 'info' ? 1 : -1
  const D = reduce ? 0 : 0.24
  const OFFSET = reduce ? 0 : 28

  return (
    <div className="min-h-[100dvh]">
      {/* While the countdown modal is up, EVERYTHING behind it is inert (not focusable, not read), so Tab cannot leave
          the dialog for the page. The modal has its own Cancel and call-911 controls. */}
      <div inert={phase === 'countdown'}>
      {/* Tailwind's own sr-only utility outranks the base-layer "visible on focus" rule, so the reveal is explicit. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to the main content
      </a>
      {/* Second in tab order on every screen, right after the skip link: help is the first thing a keyboard user reaches.
          It is fixed-position, so its place in the DOM does not change where it is drawn. */}
      <EmergencyButton />
      <SiteHeader />
      <main id="main" tabIndex={-1} className="overflow-x-clip outline-none">
        <AnimatePresence
          mode="wait"
          initial={false}
          custom={dir}
          // The new page must start at the top; doing it here (after the old one is gone, before the new one mounts)
          // avoids the old page visibly jumping while it fades out.
          onExitComplete={() => {
            if (!consumePendingAnchor()) window.scrollTo({ top: 0, behavior: 'instant' })
          }}
        >
          <motion.div
            key={route}
            custom={dir}
            variants={{
              enter: (d: number) => ({ opacity: 0, y: d * OFFSET }),
              center: { opacity: 1, y: 0 },
              exit: (d: number) => ({ opacity: 0, y: -d * OFFSET }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: D, ease: 'easeOut' }}
          >
            <CurrentScreen route={route} />
          </motion.div>
        </AnimatePresence>
      </main>
      {/* Persistent on every route and phase. Bottom padding keeps it clear of the fixed Call 911 / guide buttons. */}
      <footer className="mx-auto max-w-3xl px-4 pb-28 text-center sm:pb-24">
        <Disclaimer variant="short" className="text-[0.8125rem] leading-snug text-ink-3" />
      </footer>
      {demoEnabled && <DemoPanel />}
      <RecordPanel />
      {isSpeechRecordSearch(globalThis.location?.search ?? '') && <SpeechRecordPanel />}
      <AgentControl />
      </div>

      {phase === 'countdown' && <CountdownModal />}
    </div>
  )
}

export default function App() {
  return (
    <ConversationProvider>
      <AppContent />
    </ConversationProvider>
  )
}
