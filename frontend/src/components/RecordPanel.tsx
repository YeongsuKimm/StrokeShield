import { downloadJson, useRecorder } from '../lib/calibration/recorder'
import { findScenario, scenariosFor, type RecordingKind } from '../lib/calibration/recording'

// Calibration recorder UI. Only rendered with `?record=1`. Run a test with the normal buttons; each completed run is
// saved (and auto-downloaded) with the labels chosen here. See docs/CALIBRATION.md.
const KINDS: { kind: RecordingKind; title: string }[] = [
  { kind: 'face', title: 'Face test scenario' },
  { kind: 'arms', title: 'Arms test scenario' },
]

export function RecordPanel() {
  const r = useRecorder()
  if (!r.enabled) return null
  return (
    <div className="fixed right-4 top-4 z-20 w-80 space-y-2 rounded-lg border border-rose-500 bg-slate-900/95 p-3 text-sm shadow-xl">
      <p className="font-semibold text-rose-400">● Recording mode</p>
      <label className="block">
        Your name / id (anonymous is fine)
        <input value={r.subject} onChange={(e) => r.setSubject(e.target.value)} placeholder="e.g. sam" className="mt-1 w-full rounded bg-slate-800 px-2 py-1" />
      </label>
      {KINDS.map(({ kind, title }) => {
        const sel = findScenario(r.scenarioByKind[kind])
        return (
          <label key={kind} className="block">
            {title}
            <select value={r.scenarioByKind[kind]} onChange={(e) => r.setScenario(kind, e.target.value)} className="mt-1 w-full rounded bg-slate-800 px-2 py-1">
              {scenariosFor(kind).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            {sel && <span className="mt-1 block text-xs text-amber-200">{sel.instructions}</span>}
          </label>
        )
      })}
      <label className="block">
        Notes (glasses, lighting, distance…)
        <input value={r.notes} onChange={(e) => r.setNotes(e.target.value)} className="mt-1 w-full rounded bg-slate-800 px-2 py-1" />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={r.autoDownload} onChange={(e) => r.setAutoDownload(e.target.checked)} />
        Auto-download each run
      </label>
      {!r.subject.trim() && <p className="text-xs text-amber-300">Enter a name/id so recordings can be grouped by person.</p>}
      <div className="max-h-48 space-y-1 overflow-auto">
        {r.runs.length === 0 && <p className="text-xs text-slate-400">No runs yet. Use Run face test / Run arm test.</p>}
        {r.runs.map((run) => (
          <div key={run.id} className="flex items-center justify-between gap-2 rounded bg-slate-800 px-2 py-1 text-xs">
            <span>
              {run.kind} · {run.scenario.replace(/^(face|arms)-/, '')} · {run.needsRetry ? 'retry' : run.severity.toFixed(2)} · {run.sizeKB} KB
            </span>
            <button onClick={() => downloadJson(run.fileName, run.json)} className="rounded bg-slate-700 px-2 py-0.5">
              save
            </button>
          </div>
        ))}
      </div>
      {r.runs.length > 0 && (
        <button onClick={r.clear} className="text-xs text-slate-400 underline">
          clear list
        </button>
      )}
    </div>
  )
}
