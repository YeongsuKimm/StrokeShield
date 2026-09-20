import { useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChunkLoading, LazyBoundary } from './components/LazyBoundary'
import { CountdownModal } from './components/CountdownModal'
import { DemoPanel } from './components/DemoPanel'
import { RecordPanel } from './components/RecordPanel'
import { EmergencyButton } from './components/chrome/EmergencyButton'
import { BrowserBanner, ConnectivityBanner, ResumeNotice } from './components/chrome/StatusBanners'
import { SiteHeader } from './components/chrome/SiteHeader'
import { HomePage } from './components/pages/HomePage'
import { ResultScreen } from './components/result/ResultScreen'
import { Disclaimer } from './components/ui/Disclaimer'
import { ArmsTest } from './components/test/ArmsTest'
import { EyeTest } from './components/test/EyeTest'
import { FaceTest } from './components/test/FaceTest'
import { SpeechTest } from './components/test/SpeechTest'
import { SpeechRecordPanel } from './components/SpeechRecordPanel'
import { sendAlertForSession } from './lib/alertFlow'
import { consumePendingAnchor } from './lib/anchorTarget'
import { isSpeechRecordSearch } from './lib/calibration/recorder'
import { usePreflightUi } from './lib/preflight/store'
import { lazyChunk } from './lib/resilience/lazyChunk'
import { installBrowserLifecycle } from './lib/resilience/lifecycle'
import { installConnectivityListeners } from './lib/resilience/network'
import { installPrefetchOnConsent } from './lib/resilience/prefetch'
import { resumeCheck } from './lib/resilience/resumeCheck'
import { useSession, isResultPhase, isTestPhase } from './lib/session/store'
import { FACE_MODEL, POSE_MODEL, WASM_BASE } from './lib/vision/useMediaPipe'
import { pageTitle } from './lib/a11y/pageTitle'
import { markAppReady } from './lib/a11y/useA11y'
import { testSequence } from './lib/config'
import { pick, useLocale } from './lib/i18n'

// Loaded on demand (each its own chunk): the checks themselves never need them, so they must not delay first paint.
// The voice guide (with the ElevenLabs SDK, the heaviest dependency), the info document and the preflight panel.
const AgentDock = lazyChunk(() => import('./components/AgentControl'))
const InfoPage = lazyChunk(() => import('./components/pages/InfoPage').then((m) => ({ default: m.InfoPage })))
const PreflightPanel = lazyChunk(() => import('./components/PreflightPanel'))

/** Resilience plumbing (docs/spec/06 "Resilience"): online/offline tracking, tab-hidden and page-leave handling with
 *  the screen wake lock, and warming the vision models once the visitor has consented. */
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
  const locale = useLocale((s) => s.locale)
  const phase = useSession((s) => s.phase)
  const route = useSession((s) => s.route)
  const demoEnabled = useSession((s) => s.demoEnabled)
  const preflightOpen = usePreflightUi((s) => s.open)
  const setPreflightOpen = usePreflightUi((s) => s.setOpen)
  // A unique <title> for every screen (WCAG 2.4.2); focus moves to each screen's heading (lib/a11y/useA11y.ts).
  useEffect(() => {
    document.title = pageTitle(route, phase, testSequence(), locale)
  }, [route, phase, locale])
  useEffect(markAppReady, [])
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
      {/* While the countdown modal is up, EVERYTHING behind it is inert (not focusable, not read), so Tab cannot leave
          the dialog for the page. The modal has its own Cancel and call-911 controls. */}
      <div inert={phase === 'countdown'}>
      {/* Tailwind's own sr-only utility outranks the base-layer "visible on focus" rule, so the reveal is explicit. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
      >
        {pick(locale, 'Skip to the main content', 'Saltar al contenido principal')}
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
            transition={{ duration: D, ease: [0.16, 1, 0.3, 1] }}
          >
            <CurrentScreen route={route} />
          </motion.div>
        </AnimatePresence>
      </main>
      {/* Persistent on every route and phase. Bottom padding keeps it clear of the fixed Call 911 / guide buttons. */}
      <footer className="mx-auto max-w-3xl px-4 pb-[calc(7rem+var(--safe-b))] text-center sm:pb-[calc(6rem+var(--safe-b))]">
        {/* Not during a check: the test screen already shows this same line, so a second copy at the very bottom just repeats it. */}
        {!(route === 'home' && isTestPhase(phase)) && (
          <Disclaimer variant="short" className="text-[0.8125rem] leading-snug text-ink-3" />
        )}
        <button
          type="button"
          onClick={() => setPreflightOpen(true)}
          className="mt-2 inline-flex min-h-11 items-center px-3 text-[0.75rem] text-ink-3 underline underline-offset-2 hover:text-ink"
        >
          {pick(locale, 'Demo preflight', 'Comprobaci\u00f3n de la demo')}
        </button>
      </footer>
      <BrowserBanner />
      <ConnectivityBanner />
      <ResumeNotice />
      {demoEnabled && <DemoPanel />}
      <RecordPanel />
      {isSpeechRecordSearch(globalThis.location?.search ?? '') && <SpeechRecordPanel />}
      {/* The guide is optional: while its chunk loads, or if it cannot load at all, the checks are unaffected. */}
      <LazyBoundary what="The voice guide" reset={AgentDock.reset} fallback={null} failed={null}>
        <AgentDock />
      </LazyBoundary>
      </div>

      {phase === 'countdown' && <CountdownModal />}
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
