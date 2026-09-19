import { FEATURES } from '../lib/config'
import { useSession } from '../lib/session/store'
import type { TestName } from '../lib/contracts'

const testsToShow = (): TestName[] => (FEATURES.eyesTest ? ['face', 'arms', 'speech', 'eyes'] : ['face', 'arms', 'speech'])

export function Dashboard() {
  const { results, risk } = useSession()
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Risk dashboard</h2>
      {testsToShow().map((t) => {
        const r = results[t]
        return (
          <div key={t} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
            <div className="flex justify-between text-sm">
              <span className="font-medium capitalize">{t}</span>
              <span className="text-slate-400">
                {!r ? 'pending' : r.needsRetry ? "couldn't measure" : `conf ${(r.confidence * 100).toFixed(0)}%`}
              </span>
            </div>
            <div className="mt-2 h-2 rounded bg-slate-800">
              <div className="h-2 rounded bg-rose-500" style={{ width: `${(r && !r.needsRetry ? r.severity : 0) * 100}%` }} />
            </div>
            {r?.flags.map((f) => (
              <p key={f} className="mt-1 text-xs text-slate-400">
                • {f}
              </p>
            ))}
          </div>
        )
      })}
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
        <div className="flex justify-between text-sm">
          <span className="font-medium">Combined risk</span>
          <span>
            {risk ? `${(risk.risk * 100).toFixed(0)}%` : '—'} / threshold {risk ? `${(risk.threshold * 100).toFixed(0)}%` : '50%'}
          </span>
        </div>
        <div className="relative mt-2 h-3 rounded bg-slate-800">
          <div className={`h-3 rounded ${risk?.triggered ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${(risk?.risk ?? 0) * 100}%` }} />
          <div className="absolute top-0 h-3 w-0.5 bg-white" style={{ left: `${(risk?.threshold ?? 0.5) * 100}%` }} />
        </div>
      </div>
    </section>
  )
}
