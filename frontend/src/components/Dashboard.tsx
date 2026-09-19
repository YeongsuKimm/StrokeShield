import { useState } from 'react'
import { MAX_WEIGHTS, testSequence } from '../lib/config'
import { useSession } from '../lib/session/store'
import type { TestName, TestResult } from '../lib/contracts'
import { Icon } from './ui/Icon'
import { Meter, MicroLabel, Pill } from './ui/Primitives'

const TEST_LABEL: Record<TestName, string> = { speech: 'Speech', eyes: 'Eyes', face: 'Face', arms: 'Arms' }
const pct = (n: number) => `${Math.round(n * 100)}%`

type Status = 'pending' | 'skipped' | 'unmeasured' | 'scored'

function statusOf(r: TestResult | undefined, skipped: boolean): Status {
  if (skipped) return 'skipped'
  if (!r) return 'pending'
  return r.needsRetry ? 'unmeasured' : 'scored'
}

/** Severity band, for colour only. Anchors match the vision module's convention (healthy <= 0.15, clear >= 0.85). */
const severityTone = (s: number) => (s >= 0.6 ? 'danger' : s >= 0.3 ? 'caution' : 'ok')

function TestCard({ test }: { test: TestName }) {
  const result = useSession((s) => s.results[test])
  const skipped = useSession((s) => s.skipped.includes(test))
  const [open, setOpen] = useState(false)
  const status = statusOf(result, skipped)
  const metrics = Object.entries(result?.metrics ?? {})

  return (
    <article className="bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold tracking-tight">{TEST_LABEL[test]}</h3>
        {status === 'scored' && result ? (
          <Pill tone={severityTone(result.severity)}>{pct(result.severity)} severity</Pill>
        ) : status === 'skipped' ? (
          <Pill tone="neutral">Skipped</Pill>
        ) : status === 'unmeasured' ? (
          <Pill tone="caution" icon="alert">
            Not measured
          </Pill>
        ) : (
          <Pill tone="neutral">Waiting</Pill>
        )}
      </div>

      <div className="mt-3">
        <Meter
          value={status === 'scored' && result ? result.severity : 0}
          tone={status === 'scored' && result ? severityTone(result.severity) : 'neutral'}
          label={`${TEST_LABEL[test]} severity`}
        />
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-[0.875rem] text-ink-3">
        <span className="label-micro">Confidence</span>
        <span className="tnum">{result && !result.needsRetry ? pct(result.confidence) : '—'}</span>
        <span className="text-line-strong">·</span>
        <span className="label-micro">Max weight</span>
        <span className="tnum">{MAX_WEIGHTS[test].toFixed(2)}</span>
      </p>

      {result?.flags.length ? (
        <ul className="mt-3 space-y-1">
          {result.flags.map((f) => (
            <li key={f} className="flex gap-2 text-[0.9375rem] leading-snug text-ink-2">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-3" aria-hidden />
              {f}
            </li>
          ))}
        </ul>
      ) : null}

      {metrics.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-3 flex items-center gap-1 text-[0.9375rem] font-medium text-accent"
          >
            {open ? 'Hide' : 'Show'} the {metrics.length} raw numbers
            <Icon name="chevronDown" size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-[var(--radius-control)] bg-sunken p-3 text-[0.875rem]">
              {metrics.map(([k, v]) => (
                <div key={k} className="col-span-2 grid grid-cols-subgrid">
                  <dt className="truncate text-ink-3">{k}</dt>
                  <dd className="tnum">{Number.isFinite(v) ? v.toFixed(3) : '—'}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </article>
  )
}

/**
 * Per-check severity, confidence and raw metrics, plus the combined noisy-OR score and where the threshold sits.
 * This is the judge-facing explanation of why the app did or did not call for help (docs/spec/06).
 */
export function Dashboard() {
  const risk = useSession((s) => s.risk)
  const counted = risk?.contributions.length ?? 0

  return (
    <section aria-label="Risk breakdown" className="space-y-4">
      <div className="grid gap-px overflow-hidden rounded-[var(--radius-panel)] border border-line bg-line sm:grid-cols-2">
        {testSequence().map((t) => (
          <TestCard key={t} test={t} />
        ))}
      </div>

      <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <MicroLabel>Combined risk</MicroLabel>
            <p className="tnum mt-1 font-serif text-5xl leading-none">
              {risk ? pct(risk.risk) : '—'}
            </p>
          </div>
          <p className="text-[0.9375rem] text-ink-3">
            Alert threshold <span className="tnum">{pct(risk?.threshold ?? 0.5)}</span> ·{' '}
            {counted} of {testSequence().length} checks counted
          </p>
        </div>

        <div className="mt-4">
          <Meter
            value={risk?.risk ?? 0}
            tone={risk?.triggered ? 'danger' : 'ok'}
            mark={risk?.threshold ?? 0.5}
            height="h-3"
            label="Combined check score (uncalibrated)"
          />
        </div>

        {counted > 0 && (
          <dl className="mt-5 space-y-2 border-t border-line pt-4">
            <MicroLabel className="mb-1">How it adds up</MicroLabel>
            {risk?.contributions.map((c) => (
              <div key={c.test} className="flex items-baseline justify-between gap-3 text-[0.875rem]">
                <dt className="capitalize text-ink-2">{c.test}</dt>
                <dd className="tnum text-ink-3">
                  {c.weight.toFixed(2)} × {c.severity.toFixed(2)} × {c.confidence.toFixed(2)} ={' '}
                  <span className="text-ink">{c.contribution.toFixed(3)}</span>
                </dd>
              </div>
            ))}
            <p className="pt-1 text-[0.875rem] leading-snug text-ink-3">
              Combined with a noisy-OR, so one strong signal is enough on its own. Thresholds and weights are
              uncalibrated.
            </p>
          </dl>
        )}
      </div>
    </section>
  )
}
