import { SPEECH_TARGET_PHRASE } from '../lib/config'
import { useSpeechProgress } from '../lib/speech/speechProgressStore'

// RMS (0..1) -> meter fraction on a -60..0 dBFS scale, so quiet speech still visibly moves the bar.
const meterFraction = (rms: number): number => Math.min(1, Math.max(0, (20 * Math.log10(Math.max(rms, 1e-6)) + 60) / 60))

// Speech test UI: the phrase to say, a live level meter, the Listening / Analyzing state and the last retry hint.
export function SpeechPanel() {
  const { stage, level, hint, running } = useSpeechProgress()
  const caption = stage === 'listening' ? 'Listening…' : stage === 'analyzing' ? 'Analyzing…' : running ? 'Starting…' : 'Speech test'
  return (
    <section className="space-y-3 rounded-lg border border-slate-800 p-4" aria-live="polite">
      <p className="text-sm uppercase text-slate-400">{caption}</p>
      <p className="text-2xl font-semibold leading-snug">“{SPEECH_TARGET_PHRASE}”</p>
      <div className="h-3 w-full overflow-hidden rounded bg-slate-800" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={stage === 'listening' ? meterFraction(level) : 0}>
        <div className="h-full bg-emerald-500 transition-[width] duration-75" style={{ width: `${stage === 'listening' ? Math.round(meterFraction(level) * 100) : 0}%` }} />
      </div>
      {hint && stage === 'idle' && <p className="text-sm text-amber-300">{hint}</p>}
    </section>
  )
}
