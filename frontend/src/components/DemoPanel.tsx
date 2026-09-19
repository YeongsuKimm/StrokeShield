import { useState } from 'react'
import type { TestName, TestResult } from '../lib/contracts'
import { testSequence } from '../lib/config'
import { useSession } from '../lib/session/store'

// Demo/simulation mode (docs/spec/06). Overrides go through the normal completeTest path.
const fake = (test: TestName, severity: number, flags: string[] = []): TestResult => ({
  test,
  severity,
  confidence: 0.9,
  metrics: {},
  flags,
  startedAt: Date.now(),
  durationMs: 0,
})

export function DemoPanel() {
  const s = useSession()
  const [sev, setSev] = useState<Record<TestName, number>>({ face: 0.8, arms: 0.7, speech: 0.7, eyes: 0.6 })
  const FLAGS: Record<TestName, string> = {
    face: 'one side of the smile lifts less',
    arms: 'one arm drifted down',
    speech: 'slow, unclear speech',
    eyes: 'gaze does not track to one side',
  }
  const run = (v: Record<TestName, number>) => {
    s.reset()
    s.beginTests()
    for (const t of testSequence()) useSession.getState().completeTest(fake(t, v[t], v[t] > 0.5 ? [FLAGS[t]] : []))
  }
  return (
    <div className="fixed bottom-4 left-4 z-10 w-64 space-y-2 rounded-lg border border-amber-500 bg-slate-900 p-3 text-sm">
      <p className="font-semibold text-amber-400">Demo panel</p>
      {testSequence().map((t) => (
        <label key={t} className="block capitalize">
          {t}: {sev[t].toFixed(2)}
          <input type="range" min={0} max={1} step={0.05} value={sev[t]} onChange={(e) => setSev({ ...sev, [t]: +e.target.value })} className="w-full" />
        </label>
      ))}
      <div className="flex gap-2">
        <button onClick={() => run(sev)} className="rounded bg-amber-600 px-2 py-1">Run</button>
        <button onClick={() => run({ face: 0.8, arms: 0.7, speech: 0.7, eyes: 0.6 })} className="rounded bg-red-700 px-2 py-1">Simulate stroke</button>
        <button onClick={() => run({ face: 0.05, arms: 0.05, speech: 0.05, eyes: 0.05 })} className="rounded bg-emerald-700 px-2 py-1">Healthy</button>
      </div>
    </div>
  )
}
