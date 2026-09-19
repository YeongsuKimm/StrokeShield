import { useState } from 'react'
import { api } from '../../lib/api'
import { SPEECH_TARGET_PHRASE } from '../../lib/config'
import { useMic } from '../../lib/media/micLevel'
import { useSession } from '../../lib/session/store'
import { recordSpeech } from '../../lib/speech/recorder'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { MicroLabel } from '../ui/Primitives'
import { TestScreen } from './TestScreen'
import { Waveform } from './Waveform'

type Stage = 'ready' | 'recording' | 'analyzing' | 'failed'

/**
 * "Read this out loud." No camera here: the patient is close to the screen and only the microphone matters.
 *
 * The recorder and the analysis endpoint belong to the speech module (docs/spec/03-speech.md); this screen only
 * drives them. While `recordSpeech` is still a stub the screen fails visibly and offers a retry and a skip,
 * rather than hanging or silently passing.
 */
export function SpeechTest() {
  const completeTest = useSession((s) => s.completeTest)
  const [stage, setStage] = useState<Stage>('ready')
  const [error, setError] = useState<string | null>(null)
  const { verdict } = useMic()

  const run = async () => {
    setError(null)
    setStage('recording')
    try {
      const wav = await recordSpeech()
      setStage('analyzing')
      const result = await api.analyzeSpeech(wav, SPEECH_TARGET_PHRASE)
      completeTest(result)
    } catch (e) {
      console.debug('[speech] capture or analysis failed', e)
      setError(e instanceof Error ? e.message : String(e))
      setStage('failed')
    }
  }

  return (
    <TestScreen
      test="speech"
      title="Read this out loud"
      lede="Say it once, at your normal speaking pace. There is no rush and no right accent."
    >
      <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-6 shadow-[var(--shadow-panel)] sm:p-10">
        <MicroLabel className="mb-4 text-center">The sentence</MicroLabel>

        {/* The phrase is the hero of this screen: the largest type in the app. */}
        <blockquote className="text-balance text-center text-3xl font-semibold leading-tight tracking-tight sm:text-5xl sm:leading-[1.12]">
          “{SPEECH_TARGET_PHRASE}”
        </blockquote>

        <div className="mt-8 rounded-[var(--radius-control)] bg-sunken px-4 py-3">
          <Waveform active={stage === 'recording'} height={96} />
          <p className="mt-1 text-center text-[1rem] text-ink-3" role="status">
            {stage === 'recording'
              ? 'Listening — say the sentence now.'
              : stage === 'analyzing'
                ? 'Analysing your speech…'
                : verdict.muted
                  ? 'Waiting for your microphone.'
                  : 'Ready when you are.'}
          </p>
        </div>

        {error && (
          <p
            className="mt-5 flex items-start gap-2.5 rounded-[var(--radius-control)] border border-danger/25 bg-danger-wash px-4 py-3 text-[1rem] text-danger"
            role="alert"
          >
            <Icon name="alert" size={18} className="mt-px shrink-0" />
            <span>
              That recording did not go through. <span className="font-medium">{error}</span>
            </span>
          </p>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button
            size="lg"
            icon={stage === 'failed' ? 'refresh' : 'mic'}
            onClick={() => void run()}
            disabled={stage === 'recording' || stage === 'analyzing'}
          >
            {stage === 'recording'
              ? 'Recording…'
              : stage === 'analyzing'
                ? 'Analysing…'
                : stage === 'failed'
                  ? 'Try again'
                  : 'Start recording'}
          </Button>
        </div>
      </div>
    </TestScreen>
  )
}
