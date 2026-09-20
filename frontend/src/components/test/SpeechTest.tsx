import { smartQuotes } from '../../lib/typography'
import { pick, SPEECH_PHRASES, translateRuntimeText, useLocale } from '../../lib/i18n'
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
  const locale = useLocale((s) => s.locale)
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
        ? pick(locale, 'Listening. Say the sentence now.', 'Escuchando. Di la frase ahora.')
        : pick(locale, 'Getting the microphone ready\u2026', 'Preparando el micr\u00f3fono\u2026')
      : stage === 'analyzing'
        ? pick(locale, 'Analyzing your speech\u2026', 'Analizando tu habla\u2026')
        : verdict.muted
          ? pick(locale, 'Waiting for your microphone.', 'Esperando el micr\u00f3fono.')
          : pick(locale, 'Ready when you are.', 'Listo cuando t\u00fa lo est\u00e9s.')

  return (
    <TestScreen
      test="speech"
      title={pick(locale, 'Read this out loud', 'Lee esto en voz alta')}
      lede={pick(locale, 'Move back close to the screen, then say it once at your normal pace. No rush, no right accent.', 'Vuelve a acercarte a la pantalla y dilo una vez a tu ritmo normal. Sin prisa; no hay un acento correcto.')}
    >
      <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-6 shadow-[var(--shadow-panel)] sm:p-10">
        <MicroLabel className="mb-4 text-center">{pick(locale, 'The sentence', 'La frase')}</MicroLabel>

        {/* The phrase is the hero of this screen: the largest type in the app. */}
        <blockquote className="text-balance text-center text-3xl leading-tight sm:text-5xl sm:leading-[1.12]">
          “{smartQuotes(SPEECH_PHRASES[locale])}”
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
            {smartQuotes(translateRuntimeText(locale, hint))}
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
            {stage === 'listening' ? pick(locale, 'Recording\u2026', 'Grabando\u2026') : stage === 'analyzing' ? pick(locale, 'Analyzing\u2026', 'Analizando\u2026') : hint ? pick(locale, 'Try again', 'Intentar de nuevo') : pick(locale, 'Start recording', 'Empezar a grabar')}
          </Button>
        </div>
      </div>
    </TestScreen>
  )
}
