import { useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChunkLoading, LazyBoundary } from './components/LazyBoundary'
import { CountdownModal } from './components/CountdownModal'
import { DemoPanel } from './components/DemoPanel'
import { RecordPanel } from './components/RecordPanel'
import { EmergencyButton } from './components/chrome/EmergencyButton'
import { ConnectivityBanner, ResumeNotice } from './components/chrome/StatusBanners'
import { SiteHeader } from './components/chrome/SiteHeader'
import { HomePage } from './components/pages/HomePage'
import { ResultScreen } from './components/result/ResultScreen'
import { Disclaimer } from './components/ui/Disclaimer'
import { ArmsTest } from './components/test/ArmsTest'
import { EyeTest } from './components/test/EyeTest'
import { FaceTest } from './components/test/FaceTest'
import { SpeechTest } from './components/test/SpeechTest'
import { SpeechRecordPanel } from './components/SpeechRecordPanel'
import { api } from './lib/api'
import { consumePendingAnchor } from './lib/anchorTarget'
import { locationForAlert } from './lib/media/permissions'
import { isSpeechRecordSearch } from './lib/calibration/recorder'
import { usePreflightUi } from './lib/preflight/store'
import { performAlert } from './lib/resilience/alertFlow'
import { lazyChunk } from './lib/resilience/lazyChunk'
import { installBrowserLifecycle } from './lib/resilience/lifecycle'
import { installConnectivityListeners } from './lib/resilience/network'
import { installPrefetchOnConsent } from './lib/resilience/prefetch'
import { resumeCheck } from './lib/resilience/resumeCheck'
import { useSession, isResultPhase } from './lib/session/store'
import { FACE_MODEL, POSE_MODEL, WASM_BASE } from './lib/vision/useMediaPipe'

// Loaded on demand (each its own chunk): the checks themselves never need them, so they must not delay first paint.
// The voice guide (with the ElevenLabs SDK, the heaviest dependency), the info document and the preflight panel.
const AgentDock = lazyChunk(() => import('./components/AgentControl'))
const InfoPage = lazyChunk(() => import('./components/pages/InfoPage').then((m) => ({ default: m.InfoPage })))
const PreflightPanel = lazyChunk(() => import('./components/PreflightPanel'))

/** Sends the alert once the countdown expires. The backend decides the destination number — never this client. */
function useAlertOnExpiry() {
  const phase = useSession((s) => s.phase)
  useEffect(() => {
    if (phase !== 'alerting') return
    const st = useSession.getState()
    const symptoms = Object.values(st.results).flatMap((r) => r?.flags ?? [])
    // Location never blocks the alert: at most ALERT_LOCATION_CAP_MS for a refresh (only if already granted, never a
    // prompt), else the fix cached at the consent step, else none ("Location unavailable" in the text).
    // Without the consent tick nothing location-related is read at all. performAlert never throws: a failure (backend
    // down, timeout, offline) becomes a plain "did not go through" and the result screen keeps Call 911 prominent.
    void performAlert(
      {
        consented: st.consented,
        reason: st.alertReason,
        risk: st.risk ?? undefined,
        patientName: st.patientName,
        lastKnownWell: st.lastKnownWell,
        cachedLocation: st.location,
        symptoms,
      },
      { locate: locationForAlert, send: api.sendAlert },
    ).then((out) => useSession.getState().setAlertResult(out.status, out.response))
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

/** Resilience plumbing (docs/spec/06 "Resilience"): global error logging, online/offline tracking, tab-hidden and page-
 *  leave handling with the screen wake lock, and warming the vision models once the visitor has consented. */
function useResilience() {
  useEffect(() => {
    const offs = [
      installConnectivityListeners(),
      installBrowserLifecycle(resumeCheck),
      installPrefetchOnConsent({
        urls: [FACE_MODEL, POSE_MODEL, `${WASM_BASE}/vision_wasm_internal.js`, `${WASM_BASE}/vision_wasm_internal.wasm`],
      }),
    ]
    // Warm the small lazy chunks when the browser is idle, so opening the info page later works even if wifi drops.
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
    const id = idle ? idle(() => void import('./components/pages/InfoPage').catch(() => undefined)) : undefined
    return () => {
      offs.forEach((off) => off())
      if (id !== undefined) (globalThis as { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback?.(id)
    }
  }, [])
}

/** `route` is a PROP, not read from the store: the page that is fading out must stay what it was, or it would
 *  re-render as the destination page mid-exit and flash it before the transition. */
function CurrentScreen({ route }: { route: 'home' | 'info' }) {
  const phase = useSession((s) => s.phase)

  if (route === 'info')
    return (
      <LazyBoundary what="The information page" reset={InfoPage.reset} fallback={<ChunkLoading label="Loading the information page…" />}>
        <InfoPage />
      </LazyBoundary>
    )
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
  const preflightOpen = usePreflightUi((s) => s.open)
  const setPreflightOpen = usePreflightUi((s) => s.setOpen)
  useAlertOnExpiry()
  useDemoHotkey()
  useResilience()

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
      {/* Persistent on every route and phase. Bottom padding keeps it clear of the fixed Call 911 / guide buttons. */}
      <footer className="mx-auto max-w-3xl px-4 pb-28 text-center sm:pb-24">
        <Disclaimer variant="short" className="text-[0.8125rem] leading-snug text-ink-3" />
        <button
          type="button"
          onClick={() => setPreflightOpen(true)}
          className="mt-2 text-[0.75rem] text-ink-3 underline underline-offset-2 hover:text-ink"
        >
          Demo preflight
        </button>
      </footer>
      <EmergencyButton />
      <ConnectivityBanner />
      <ResumeNotice />

      {phase === 'countdown' && <CountdownModal />}
      {demoEnabled && <DemoPanel />}
      <RecordPanel />
      {isSpeechRecordSearch(globalThis.location?.search ?? '') && <SpeechRecordPanel />}
      {/* The guide is optional: while its chunk loads, or if it cannot load at all, the checks are unaffected. */}
      <LazyBoundary what="The voice guide" reset={AgentDock.reset} fallback={null} failed={null}>
        <AgentDock />
      </LazyBoundary>
      {preflightOpen && (
        <LazyBoundary what="The preflight panel" reset={PreflightPanel.reset} fallback={<ChunkLoading label="Loading the preflight…" />}>
          <PreflightPanel onClose={() => setPreflightOpen(false)} />
        </LazyBoundary>
      )}
    </div>
  )
}

export default function App() {
  return <AppContent />
}
