import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { browserPreflightEnv } from '../lib/preflight/browserEnv'
import { buildChecks, overall, runPreflight, type CheckResult, type CheckStatus } from '../lib/preflight/checks'
import { Button } from './ui/Button'

type Row = CheckResult | 'running' | undefined

const DOT: Record<CheckStatus | 'running', string> = {
  ok: 'bg-ok',
  warn: 'bg-caution',
  fail: 'bg-danger',
  running: 'bg-ink-3 animate-pulse',
}
const WORD: Record<CheckStatus | 'running', string> = { ok: 'OK', warn: 'Caution', fail: 'Fix this', running: 'Checking…' }

/**
 * Demo preflight (`?preflight=1` or the footer link). Nothing is captured or stored: the camera and microphone are only
 * listed and their permission queried, the voice guide is only asked for a link, the models are loaded and closed.
 */
export default function PreflightPanel({ onClose }: { onClose: () => void }) {
  const checks = useMemo(() => buildChecks(browserPreflightEnv()), [])
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [busy, setBusy] = useState(true)
  const alive = useRef(true)

  // Runs every check; the caller decides how to reset the display first.
  const execute = useCallback(async () => {
    await runPreflight(checks, (id, r) => alive.current && setRows((prev) => ({ ...prev, [id]: r })))
    if (alive.current) setBusy(false)
  }, [checks])

  const runAgain = () => {
    setBusy(true)
    setRows({})
    void execute()
  }

  useEffect(() => {
    alive.current = true
    void execute()
    return () => {
      alive.current = false
    }
  }, [execute])

  const settled = Object.fromEntries(Object.entries(rows).filter((e): e is [string, CheckResult] => typeof e[1] === 'object'))
  const verdict = busy ? 'pending' : overall(settled)
  const headline =
    verdict === 'ok'
      ? 'Ready for the demo.'
      : verdict === 'warn'
        ? 'Ready, with caveats below.'
        : verdict === 'fail'
          ? 'Not ready: fix the red rows.'
          : 'Checking…'

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-paper" role="dialog" aria-modal="true" aria-label="Demo preflight">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <p className="label-micro">Demo preflight</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight" role="status">
          {headline}
        </h1>
        <p className="mt-2 text-[0.9375rem] text-ink-3">
          Nothing is recorded or stored. The camera and microphone are only listed, not opened.
        </p>

        <ul className="mt-6 divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
          {checks.map((c) => {
            const r = rows[c.id]
            const key: CheckStatus | 'running' = r === undefined || r === 'running' ? 'running' : r.status
            return (
              <li key={c.id} className="px-5 py-4" data-testid={`preflight-${c.id}`} data-status={key}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{c.label}</span>
                  <span className="flex items-center gap-2 text-[0.875rem] text-ink-2">
                    <span className={`inline-block size-3 rounded-full ${DOT[key]}`} aria-hidden />
                    {WORD[key]}
                  </span>
                </div>
                {r && r !== 'running' && (
                  <>
                    <p className="mt-1 text-[0.9375rem] text-ink-2">{r.detail}</p>
                    {r.fix && <p className="mt-0.5 text-[0.9375rem] text-ink">Fix: {r.fix}</p>}
                  </>
                )}
              </li>
            )
          })}
        </ul>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button icon="refresh" onClick={runAgain} disabled={busy}>
            Run again
          </Button>
          <Button tone="quiet" onClick={onClose}>
            Close
          </Button>
          <a href="tel:911" className="ml-auto text-[0.9375rem] font-medium text-danger underline underline-offset-4">
            Call 911
          </a>
        </div>
      </div>
    </div>
  )
}
