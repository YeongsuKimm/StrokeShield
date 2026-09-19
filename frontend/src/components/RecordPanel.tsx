import { downloadJson, useRecorder } from '../lib/calibration/recorder'
import { findScenario, LIGHTING_VALUES, scenariosFor, type Lighting, type RecordingKind } from '../lib/calibration/recording'

// Vision calibration recorder UI. Rendered with `?record=vision` (or legacy `?record=1`). Each completed run is
// saved (and auto-downloaded) with the labels chosen here. See docs/CALIBRATION.md.
const KINDS: { kind: RecordingKind; title: string }[] = [
  { kind: 'eyes', title: 'Eyes test scenario' },
  { kind: 'face', title: 'Face test scenario' },
  { kind: 'arms', title: 'Arms test scenario' },
]

/** yes / no / not recorded, so an untouched field is stored as null instead of a false "no". */
const triToValue = (v: boolean | null | undefined): string => (v === true ? 'yes' : v === false ? 'no' : '')
const valueToTri = (v: string): boolean | null => (v === 'yes' ? true : v === 'no' ? false : null)

export function RecordPanel() {
  const r = useRecorder()
  if (!r.enabled) return null
  const c = r.conditions
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
      <fieldset className="grid grid-cols-2 gap-2 rounded border border-slate-700 p-2">
        <legend className="px-1 text-xs text-slate-300">Conditions (remembered)</legend>
        <label className="text-xs">
          Glasses
          <select value={triToValue(c.glasses)} onChange={(e) => r.setConditions({ glasses: valueToTri(e.target.value) })} className="mt-0.5 w-full rounded bg-slate-800 px-1 py-1">
            <option value="">?</option>
            <option value="yes">yes</option>
            <option value="no">no</option>
          </select>
        </label>
        <label className="text-xs">
          Facial hair
          <select value={triToValue(c.facialHair)} onChange={(e) => r.setConditions({ facialHair: valueToTri(e.target.value) })} className="mt-0.5 w-full rounded bg-slate-800 px-1 py-1">
            <option value="">?</option>
            <option value="yes">yes</option>
            <option value="no">no</option>
          </select>
        </label>
        <label className="text-xs">
          Lighting
          <select value={c.lighting ?? ''} onChange={(e) => r.setConditions({ lighting: (e.target.value || null) as Lighting | null })} className="mt-0.5 w-full rounded bg-slate-800 px-1 py-1">
            <option value="">?</option>
            {LIGHTING_VALUES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Distance (m)
          <input
            type="number"
            min={0}
            step={0.1}
            value={c.distanceM ?? ''}
            onChange={(e) => r.setConditions({ distanceM: e.target.value === '' || !Number.isFinite(Number(e.target.value)) ? null : Number(e.target.value) })}
            className="mt-0.5 w-full rounded bg-slate-800 px-1 py-1"
          />
        </label>
        <label className="col-span-2 text-xs">
          Camera / laptop model
          <input value={c.device ?? ''} onChange={(e) => r.setConditions({ device: e.target.value.trim() ? e.target.value : null })} placeholder="e.g. ThinkPad X1" className="mt-0.5 w-full rounded bg-slate-800 px-1 py-1" />
        </label>
      </fieldset>
      <label className="block">
        Notes (anything else)
        <input value={r.notes} onChange={(e) => r.setNotes(e.target.value)} className="mt-1 w-full rounded bg-slate-800 px-2 py-1" />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={r.autoDownload} onChange={(e) => r.setAutoDownload(e.target.checked)} />
        Auto-download each run
      </label>
      {!r.subject.trim() && <p className="text-xs text-amber-300">Enter a name/id so recordings can be grouped by person.</p>}
      <div className="max-h-48 space-y-1 overflow-auto">
        {r.runs.length === 0 && <p className="text-xs text-slate-400">No runs yet. Start a vision test.</p>}
        {r.runs.map((run) => (
          <div key={run.id} className="flex items-center justify-between gap-2 rounded bg-slate-800 px-2 py-1 text-xs">
            <span>
              {run.kind} · {run.scenario.replace(/^(face|arms|eyes)-/, '')} · {run.needsRetry ? 'retry' : run.severity.toFixed(2)} · {run.sizeKB} KB
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
