import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { testSequence } from '../lib/config'
import { useSession } from '../lib/session/store'
import { speechRunner } from '../lib/speech/speechRunner'
import { testRunner } from '../lib/vision/useTestRunner'
import type { HealthResponse, TestName, TestResult } from '../lib/contracts'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'

// Demo/simulation mode (docs/spec/06). Overrides go through the normal completeTest path, so scoring, the
// dashboard, the agent context and the alert code all run for real.
const fake = (test: TestName, severity: number, flags: string[] = []): TestResult => ({
  test,
  severity,
  confidence: 0.9,
  metrics: {},
  flags,
  startedAt: Date.now(),
  durationMs: 0,
})

const FLAGS: Record<TestName, string> = {
  face: 'one side of the smile lifts less',
  arms: 'one arm drifted down',
  speech: 'slow, unclear speech',
  eyes: 'gaze does not track to one side',
}

const STROKE = { face: 0.8, arms: 0.7, speech: 0.7, eyes: 0.6 }
const HEALTHY = { face: 0.05, arms: 0.05, speech: 0.05, eyes: 0.05 }

export function DemoPanel() {
  const s = useSession()
  const [sev, setSev] = useState<Record<TestName, number>>(STROKE)
  const [open, setOpen] = useState(true)
  const [health, setHealth] = useState<HealthResponse | null>(null)

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null))
  }, [])

  // Stop any live camera / microphone check first, like the logo does, so a real run cannot finish underneath the
  // simulated one and overwrite it.
  const stopRunners = () => {
    testRunner.cancel()
    speechRunner.cancel()
  }

  const run = (v: Record<TestName, number>) => {
    stopRunners()
    s.reset()
    s.beginTests()
    for (const t of testSequence()) useSession.getState().completeTest(fake(t, v[t], v[t] > 0.5 ? [FLAGS[t]] : []))
  }

  const armed = health && !health.dryRun

  return (
    <aside className="fixed bottom-5 right-5 z-40 w-72 overflow-hidden rounded-[var(--radius-panel)] border border-ink/15 bg-surface shadow-[var(--shadow-lift)]">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <p className="label-micro">Demo panel</p>
        <div className="flex items-center gap-2">
          <span
            className={`label-micro rounded-full px-2 py-0.5 ${
              !health ? 'bg-sunken text-ink-3' : armed ? 'bg-danger text-white' : 'bg-ok-wash text-ok'
            }`}
          >
            {!health ? 'backend offline' : armed ? 'live texts armed' : 'dry run'}
          </span>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Toggle demo panel">
            <Icon name="chevronDown" size={16} className={`text-ink-3 transition-transform ${open ? '' : 'rotate-180'}`} />
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-3 p-4">
          {testSequence().map((t) => (
            // The label does have text ({t} below); the rule cannot see through the expression.
            // oxlint-disable-next-line jsx-a11y/label-has-associated-control
            <label key={t} className="block">
              <span className="flex items-baseline justify-between text-[0.9375rem]">
                <span className="capitalize">{t}</span>
                <span className="tnum text-ink-3">{sev[t].toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={sev[t]}
                onChange={(e) => setSev({ ...sev, [t]: +e.target.value })}
                className="mt-1 w-full accent-[var(--color-accent)]"
              />
            </label>
          ))}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button size="sm" onClick={() => run(sev)}>
              Run these
            </Button>
            <Button size="sm" tone="quiet" onClick={() => s.requestEmergency('user_request')}>
              Countdown
            </Button>
            <Button size="sm" tone="danger" onClick={() => run(STROKE)}>
              Simulate stroke
            </Button>
            <Button size="sm" tone="quiet" onClick={() => run(HEALTHY)}>
              Simulate healthy
            </Button>
          </div>

          <Button
            size="sm"
            tone="quiet"
            block
            icon="refresh"
            onClick={() => {
              stopRunners()
              s.reset()
            }}
          >
            Reset session
          </Button>
        </div>
      )}
    </aside>
  )
}
