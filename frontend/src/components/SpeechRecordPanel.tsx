import { useRecorder } from '../lib/calibration/recorder'
import { MIC_VALUES, NOISE_VALUES, type MicKind, type NoiseLevel } from '../lib/calibration/recording'
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
  const c = useRecorder((s) => s.conditions)
  const setConditions = useRecorder((s) => s.setConditions)
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
      <fieldset className="grid grid-cols-2 gap-2 rounded border border-slate-700 p-2">
        <legend className="px-1 text-xs text-slate-300">Conditions (remembered)</legend>
        <label className="text-xs">
          Microphone
          <select value={c.mic ?? ''} onChange={(e) => setConditions({ mic: (e.target.value || null) as MicKind | null })} className="mt-0.5 w-full rounded bg-slate-800 px-1 py-1">
            <option value="">?</option>
            {MIC_VALUES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Background noise
          <select value={c.noise ?? ''} onChange={(e) => setConditions({ noise: (e.target.value || null) as NoiseLevel | null })} className="mt-0.5 w-full rounded bg-slate-800 px-1 py-1">
            <option value="">?</option>
            {NOISE_VALUES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Native English
          <select
            value={c.nativeEnglish === true ? 'yes' : c.nativeEnglish === false ? 'no' : ''}
            onChange={(e) => setConditions({ nativeEnglish: e.target.value === 'yes' ? true : e.target.value === 'no' ? false : null })}
            className="mt-0.5 w-full rounded bg-slate-800 px-1 py-1"
          >
            <option value="">?</option>
            <option value="yes">yes</option>
            <option value="no">no</option>
          </select>
        </label>
        <label className="text-xs">
          Mic / laptop model
          <input value={c.device ?? ''} onChange={(e) => setConditions({ device: e.target.value.trim() ? e.target.value : null })} placeholder="e.g. ThinkPad X1" className="mt-0.5 w-full rounded bg-slate-800 px-1 py-1" />
        </label>
      </fieldset>
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
