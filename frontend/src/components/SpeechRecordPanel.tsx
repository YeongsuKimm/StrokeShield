import { useRecorder } from '../lib/calibration/recorder'
import { downloadSpeechRun, useSpeechRecorder } from '../lib/speech/speechRecorder'
import { findSpeechScenario, SPEECH_SCENARIOS } from '../lib/speech/speechScenarios'

// Speech calibration recorder UI. App renders it only with `?record=1`. Pick a scenario, press "Run speech test", say the
// phrase as instructed; the .wav + .json pair is saved (and auto-downloaded). Put the files in recordings/speech/.
// Name / notes / auto-download are shared with RecordPanel (lib/calibration/recorder).
export function SpeechRecordPanel() {
  const r = useSpeechRecorder()
  const subject = useRecorder((s) => s.subject)
  const autoDownload = useRecorder((s) => s.autoDownload)
  const setAutoDownload = useRecorder((s) => s.setAutoDownload)
  const sel = findSpeechScenario(r.scenario)
  return (
    <div className="fixed bottom-4 left-4 z-20 w-80 space-y-2 rounded-lg border border-rose-500 bg-slate-900/95 p-3 text-sm shadow-xl">
      <p className="font-semibold text-rose-400">● Speech recording</p>
      <label className="block">
        Speech scenario
        <select value={r.scenario} onChange={(e) => r.setScenario(e.target.value)} className="mt-1 w-full rounded bg-slate-800 px-2 py-1">
          {SPEECH_SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        {sel && <span className="mt-1 block text-xs text-amber-200">{sel.instructions}</span>}
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={autoDownload} onChange={(e) => setAutoDownload(e.target.checked)} />
        Auto-download each run (.wav + .json)
      </label>
      {!subject.trim() && <p className="text-xs text-amber-300">Enter your name/id in the other recording panel.</p>}
      <div className="max-h-40 space-y-1 overflow-auto">
        {r.runs.length === 0 && <p className="text-xs text-slate-400">No runs yet. Use Run speech test.</p>}
        {r.runs.map((run) => (
          <div key={run.id} className="flex items-center justify-between gap-2 rounded bg-slate-800 px-2 py-1 text-xs">
            <span>
              {run.scenario.replace(/^speech-/, '')} · {run.needsRetry ? 'retry' : run.severity.toFixed(2)} · {run.durationS.toFixed(1)} s
            </span>
            <button onClick={() => downloadSpeechRun(run)} className="rounded bg-slate-700 px-2 py-0.5">
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
