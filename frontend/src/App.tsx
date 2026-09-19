import { useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CountdownModal } from './components/CountdownModal'
import { DemoPanel } from './components/DemoPanel'
import { RecordPanel } from './components/RecordPanel'
import { EmergencyButton } from './components/chrome/EmergencyButton'
import { SiteHeader } from './components/chrome/SiteHeader'
import { HomePage } from './components/pages/HomePage'
import { InfoPage } from './components/pages/InfoPage'
import { ResultScreen } from './components/result/ResultScreen'
import { ArmsTest } from './components/test/ArmsTest'
import { EyeTest } from './components/test/EyeTest'
import { FaceTest } from './components/test/FaceTest'
import { SpeechTest } from './components/test/SpeechTest'
import { SpeechRecordPanel } from './components/SpeechRecordPanel'
import { api } from './lib/api'
import { consumePendingAnchor } from './lib/anchorTarget'
import { isSpeechRecordSearch } from './lib/calibration/recorder'
import { useSession, isResultPhase } from './lib/session/store'
import { ConversationProvider } from '@elevenlabs/react'
import { useAgent } from './lib/agent/useAgent'

function AgentControl() {
  const { start, end, status } = useAgent()
  const connected = status === 'connected'
  const connecting = status === 'connecting'

  return (
    // Top-centre from `sm` up. On a phone the header already fills the top edge (brand + menu), so the control
    // sits bottom-right instead (opposite the Call 911 button), with the status text kept for screen readers only.
    <div className="fixed bottom-5 right-5 z-40 flex items-center gap-3 rounded-full border border-line bg-surface p-1.5 shadow-[var(--shadow-lift)] sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-7 sm:-translate-x-1/2 sm:px-4 sm:py-2">
      <span className="sr-only text-[0.875rem] text-ink-2 sm:not-sr-only" role="status">
        {connected ? 'Guide is listening' : connecting ? 'Connecting…' : 'Voice guide'}
      </span>
      <button
        type="button"
        onClick={() => void (connected ? end() : start())}
        disabled={connecting}
        className="rounded-full bg-ink px-4 py-2 text-[0.875rem] font-semibold text-paper transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {connected ? 'End guide' : 'Start guide'}
      </button>
    </div>
  )
}

/** Sends the alert once the countdown expires. The backend decides the destination number — never this client. */
function useAlertOnExpiry() {
  const phase = useSession((s) => s.phase)
  useEffect(() => {
    if (phase !== 'alerting') return
    const st = useSession.getState()
    const symptoms = Object.values(st.results).flatMap((r) => r?.flags ?? [])
    api
      .sendAlert({
        reason: st.alertReason ?? 'user_request',
        risk: st.risk ?? undefined,
        patient: { name: st.patientName },
        lastKnownWell: st.lastKnownWell,
        location: st.location,
        symptoms,
      })
      .then((res) => st.setAlertResult(res.ok ? 'sent' : 'failed', res))
      .catch((e) => st.setAlertResult('failed', { ok: false, dryRun: false, error: String(e) }))
  }, [phase])
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
      {/* Tailwind's own sr-only utility outranks the base-layer "visible on focus" rule, so the reveal is explicit. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to the main content
      </a>
      <SiteHeader />
      {/* While the countdown modal is up, nothing behind it should take focus (it is aria-modal). */}
      <main id="main" className="overflow-x-clip" inert={phase === 'countdown'}>
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
      <EmergencyButton />

      {phase === 'countdown' && <CountdownModal />}
      {demoEnabled && <DemoPanel />}
      <RecordPanel />
      {isSpeechRecordSearch(globalThis.location?.search ?? '') && <SpeechRecordPanel />}
      <AgentControl />
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
