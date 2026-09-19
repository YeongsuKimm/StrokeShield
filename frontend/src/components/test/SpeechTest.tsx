import { SPEECH_TARGET_PHRASE } from '../../lib/config'
import { useMic } from '../../lib/media/micLevel'
import { useSpeechProgress } from '../../lib/speech/speechProgressStore'
import { useSpeechRunner } from '../../lib/speech/speechRunner'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { MicroLabel } from '../ui/Primitives'
import { TestScreen } from './TestScreen'
import { Waveform } from './Waveform'

/**
 * "Read this out loud." No camera here: the patient is close to the screen and only the microphone matters.
 *
 * This screen only DRIVES the speech module: `speechRunner.runSpeech()` (lib/speech, spec 03) records, analyses,
 * stores the result through `completeTest`, and publishes a stage and a spoken-style retry hint to
 * `useSpeechProgress`. The voice agent's `start_speech_test` calls the very same function.
 * The runner always resolves (never throws), so a mic error or a bad recording shows up as a hint here rather
 * than a crash; the skip hatch in TestScreen is the way out if it keeps failing.
 */
export function SpeechTest() {
  const { runSpeech, running } = useSpeechRunner()
  const stage = useSpeechProgress((s) => s.stage)
  const hint = useSpeechProgress((s) => s.hint)
  // The first audio chunk arrives a beat after the click (the mic is still opening). Ask for the sentence only once sound is
  // flowing, or the first word ("You can't...") gets lost.
  const heard = useSpeechProgress((s) => s.heard)
  const { verdict } = useMic()

  const status =
    stage === 'listening'
      ? heard
        ? 'Listening. Say the sentence now.'
        : 'Getting the microphone ready…'
      : stage === 'analyzing'
        ? 'Analysing your speech…'
        : verdict.muted
          ? 'Waiting for your microphone.'
          : 'Ready when you are.'

  return (
    <TestScreen
      test="speech"
      title="Read this out loud"
      lede="Move back close to the screen, then say it once at your normal pace. No rush, no right accent."
    >
      <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-6 shadow-[var(--shadow-panel)] sm:p-10">
        <MicroLabel className="mb-4 text-center">The sentence</MicroLabel>

        {/* The phrase is the hero of this screen: the largest type in the app. */}
        <blockquote className="text-balance text-center text-3xl leading-tight sm:text-5xl sm:leading-[1.12]">
          “{SPEECH_TARGET_PHRASE}”
        </blockquote>

        <div className="mt-8 rounded-[var(--radius-control)] bg-sunken px-4 py-3">
          <Waveform active={stage === 'listening'} height={96} />
          <p className="mt-1 text-center text-[1rem] text-ink-3" role="status">
            {status}
          </p>
        </div>

        {/* A retry hint from the last run (mic blocked, too quiet, cut off...). Cleared when a new run starts. */}
        {hint && !running && (
          <p
            className="mt-5 flex items-start gap-2.5 rounded-[var(--radius-control)] border border-caution/30 bg-caution-wash px-4 py-3 text-[1rem] text-caution"
            role="alert"
          >
            <Icon name="alert" size={18} className="mt-px shrink-0" />
            {hint}
          </p>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button
            size="lg"
            icon={hint && !running ? 'refresh' : 'mic'}
            // aria-disabled (not disabled) while recording: the button keeps keyboard focus instead of dropping it.
            onClick={() => !running && void runSpeech()}
            aria-disabled={running}
          >
            {stage === 'listening' ? 'Recording…' : stage === 'analyzing' ? 'Analysing…' : hint ? 'Try again' : 'Start recording'}
          </Button>
        </div>
      </div>
    </TestScreen>
  )
}
