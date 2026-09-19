import { useEffect } from 'react'
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
import { api } from './lib/api'
import { useSession, isResultPhase } from './lib/session/store'

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
      if (e.shiftKey && (e.key === 'D' || e.key === 'd') && !/^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement)?.tagName)) {
        setDemoEnabled(!useSession.getState().demoEnabled)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [setDemoEnabled])
}

function CurrentScreen() {
  const route = useSession((s) => s.route)
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

export default function App() {
  const phase = useSession((s) => s.phase)
  const route = useSession((s) => s.route)
  const demoEnabled = useSession((s) => s.demoEnabled)
  useAlertOnExpiry()
  useDemoHotkey()

  // Every route change starts at the top of the new document rather than wherever the last one was scrolled.
  // (The "no scrolling to the info page once a check starts" rule is enforced by the home page's hand-off only
  // listening while idle. The page itself is never scroll-locked: that hid the skip button on short windows and
  // made the result screen unreachable below the fold.)
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [route])

  return (
    <div className="min-h-[100dvh]">
      <a href="#main" className="sr-only">
        Skip to the main content
      </a>
      <SiteHeader />
      <main id="main">
        <CurrentScreen />
      </main>
      <EmergencyButton />

      {phase === 'countdown' && <CountdownModal />}
      {demoEnabled && <DemoPanel />}
      <RecordPanel />
    </div>
  )
}
