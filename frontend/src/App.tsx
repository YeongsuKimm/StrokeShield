import { useEffect, useState } from 'react'
import { CountdownModal } from './components/CountdownModal'
import { CameraView } from './components/CameraView'
import { Dashboard } from './components/Dashboard'
import { DemoPanel } from './components/DemoPanel'
import { api } from './lib/api'
import type { HealthResponse } from './lib/contracts'
import { useSession } from './lib/session/store'
import { useTestRunner } from './lib/vision/useTestRunner'

export default function App() {
  const s = useSession()
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const runner = useTestRunner() // TEMP manual test buttons; remove with the block below once the voice agent drives the tests

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null))
  }, [])

  // Send the alert once the countdown expires. The backend decides the destination number.
  useEffect(() => {
    if (s.phase !== 'alerting') return
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
  }, [s.phase])

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">StrokeShield</h1>
        <span className="text-xs text-slate-400">
          {health ? (health.dryRun ? 'backend: DRY RUN' : 'backend: LIVE CALLS ARMED') : 'backend: offline'}
        </span>
      </header>

      <p className="text-sm text-slate-400">Demo only — not a medical device. In an emergency call 911.</p>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="space-y-3 rounded-lg border border-slate-800 p-4">
          <p className="text-sm uppercase text-slate-400">Phase</p>
          <p className="text-3xl font-semibold">{s.phase}</p>
          {s.phase === 'idle' && <button onClick={s.start} className="rounded bg-sky-600 px-4 py-2">Start check</button>}
          {s.phase === 'consent' && <button onClick={s.acceptConsent} className="rounded bg-sky-600 px-4 py-2">I consent (camera, mic, location)</button>}
          {s.phase === 'intro' && <button onClick={s.beginTests} className="rounded bg-sky-600 px-4 py-2">Begin tests</button>}
          {['clear', 'cancelled', 'alerted'].includes(s.phase) && <button onClick={s.reset} className="rounded bg-slate-700 px-4 py-2">Start over</button>}
          {s.alertStatus !== 'none' && (
            <p className="text-sm">
              Alert: {s.alertStatus}
              {s.alertResponse?.dryRun ? ' (dry run — nothing sent)' : ''}
              {s.alertResponse?.error ? ` — ${s.alertResponse.error}` : ''}
            </p>
          )}
          <CameraView />
          {/* TEMP manual test controls (exercise the camera flow without the voice agent). Delete this block to remove. */}
          <div className="flex flex-wrap gap-2">
            <button disabled={runner.running !== null} onClick={() => void runner.runFace()} className="rounded bg-sky-600 px-4 py-2 disabled:opacity-40">Run face test</button>
            <button disabled={runner.running !== null} onClick={() => void runner.runArms()} className="rounded bg-sky-600 px-4 py-2 disabled:opacity-40">Run arm test</button>
            {runner.running && <button onClick={runner.cancel} className="rounded bg-slate-700 px-4 py-2">Cancel test</button>}
          </div>
        </section>
        <Dashboard />
      </div>

      <a href="tel:911" className="inline-block rounded bg-red-700 px-4 py-2 font-semibold">Call 911</a>

      {s.phase === 'countdown' && <CountdownModal />}
      {s.demoEnabled && <DemoPanel />}
    </main>
  )
}
