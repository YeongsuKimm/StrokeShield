// Speech test runner: record -> POST /api/speech/analyze -> session store. Same contract as the vision runner.
//
// Non-React entry point (what the ElevenLabs client tool calls; do NOT edit lib/agent/* from here):
//   import { speechRunner } from '../speech/speechRunner'
//   start_speech_test: async () => summarize(await speechRunner.runSpeech())
// It returns Promise<TestResult> and ALWAYS resolves (never rejects): mic denied, nothing heard, too quiet/loud, backend
// offline or slow, and cancel all come back as `needsRetry: true` results with a spoken-style `flags[0]`. Non-cancelled
// results are also stored via useSession.completeTest. Calling runSpeech twice returns the in-flight promise.
// Audio that is unusable client-side (no speech, too quiet, too loud) is NOT sent to the backend.
//
// React entry point: `useSpeechRunner()` returns { runSpeech, cancel, running }.
import { api } from '../api'
import { SPEECH_TARGET_PHRASE } from '../config'
import type { TestResult } from '../contracts'
import { useSession } from '../session/store'
import { MIC_ERROR_TEXT, MicError, RecordingCancelled } from './micErrors'
import { recordSpeech, type RecordSpeechOptions, type SpeechRecording } from './recorder'
import { recordSpeechRun } from './speechRecorder'
import { useSpeechProgress, type SpeechProgress } from './speechProgressStore'

export const SPEECH_HINTS = {
  cancelled: 'Cancelled.',
  noSpeech: "I didn't hear anything. Please try again and say the sentence clearly.",
  tooQuiet: "I couldn't hear you, please speak louder.",
  tooLoud: 'That was too loud and distorted. Please speak a little softer, or move back from the microphone.',
  timeout: 'The analysis took too long. Please try again.',
  backend: "I couldn't reach the analysis service. Please try again.",
} as const

export interface SpeechRunnerDeps {
  record: (opts: RecordSpeechOptions) => Promise<SpeechRecording>
  analyze: (wav: Blob, targetPhrase: string) => Promise<TestResult>
  completeTest: (r: TestResult) => void
  setHint: (h?: string) => void
  publish: (p: Partial<SpeechProgress> & { running?: boolean }) => void
  /** Epoch ms. */
  now: () => number
  targetPhrase: string
  /** Called once per recorded clip that contained speech (calibration recorder; no-op unless `?record=1`). */
  onRecorded: (rec: SpeechRecording, result: TestResult) => void
}

const defaultDeps = (): SpeechRunnerDeps => ({
  record: (opts) => recordSpeech(opts),
  analyze: (wav, phrase) => api.analyzeSpeech(wav, phrase),
  completeTest: (r) => useSession.getState().completeTest(r),
  setHint: (h) => useSession.getState().setHint(h),
  publish: (p) => useSpeechProgress.getState().set(p),
  now: () => Date.now(),
  targetPhrase: SPEECH_TARGET_PHRASE,
  onRecorded: recordSpeechRun,
})

export interface SpeechRunner {
  runSpeech: () => Promise<TestResult>
  cancel: () => void
  readonly running: boolean
}

const retryResult = (reason: string, startedAt: number, durationMs: number): TestResult => ({
  test: 'speech',
  severity: 0,
  confidence: 0, // always below MIN_CONFIDENCE (config.ts)
  metrics: {},
  flags: [reason],
  startedAt,
  durationMs,
  needsRetry: true,
})

const isAbortError = (e: unknown) => (e as { name?: string } | null)?.name === 'AbortError'
const looksLikeResult = (r: unknown): r is TestResult =>
  !!r && typeof (r as TestResult).severity === 'number' && typeof (r as TestResult).confidence === 'number' && Array.isArray((r as TestResult).flags)

export function createSpeechRunner(overrides: Partial<SpeechRunnerDeps> = {}): SpeechRunner {
  const deps = { ...defaultDeps(), ...overrides }
  let current: { token: symbol; promise: Promise<TestResult>; abort: AbortController } | null = null

  async function execute(abort: AbortController): Promise<{ result: TestResult; cancelled: boolean }> {
    const startedAt = deps.now()
    const done = (result: TestResult) => ({ result, cancelled: false })
    const retry = (reason: string) => done(retryResult(reason, startedAt, deps.now() - startedAt))
    const cancelled = () => ({ result: retryResult(SPEECH_HINTS.cancelled, startedAt, deps.now() - startedAt), cancelled: true })
    const abortPromise = new Promise<'aborted'>((resolve) => {
      if (abort.signal.aborted) resolve('aborted')
      else abort.signal.addEventListener('abort', () => resolve('aborted'), { once: true })
    })

    let rec: SpeechRecording
    try {
      deps.publish({ stage: 'listening', level: 0 })
      rec = await deps.record({ signal: abort.signal, onLevel: (level) => deps.publish({ level }) })
    } catch (e) {
      if (e instanceof RecordingCancelled || abort.signal.aborted) return cancelled()
      if (e instanceof MicError) return retry(`I couldn't start the microphone. ${MIC_ERROR_TEXT[e.kind]}`)
      console.debug('[speech] recording failed', e)
      return retry(`I couldn't use the microphone. ${MIC_ERROR_TEXT.unknown}`)
    }
    if (abort.signal.aborted) return cancelled()

    // Client-side QC: do not send unusable audio to the backend.
    if (!rec.qc.speechDetected) return retry(SPEECH_HINTS.noSpeech)
    const unusable =
      rec.qc.level === 'too-quiet' ? SPEECH_HINTS.tooQuiet : rec.qc.level === 'too-loud' ? SPEECH_HINTS.tooLoud : null
    if (unusable) {
      const r = retryResult(unusable, startedAt, deps.now() - startedAt)
      safeRecorded(rec, r)
      return done(r)
    }

    deps.publish({ stage: 'analyzing', level: 0 })
    let result: TestResult
    try {
      const outcome = await Promise.race([deps.analyze(rec.wav, deps.targetPhrase), abortPromise])
      if (outcome === 'aborted') return cancelled()
      if (!looksLikeResult(outcome)) throw new Error('malformed speech result')
      result = outcome
    } catch (e) {
      if (abort.signal.aborted) return cancelled()
      console.debug('[speech] analyze failed', e)
      result = retryResult(isAbortError(e) ? SPEECH_HINTS.timeout : SPEECH_HINTS.backend, startedAt, deps.now() - startedAt)
    }
    safeRecorded(rec, result)
    return done(result)
  }

  function safeRecorded(rec: SpeechRecording, result: TestResult) {
    try {
      deps.onRecorded(rec, result)
    } catch (e) {
      console.debug('[speech] onRecorded threw', e)
    }
  }

  function clearIfCurrent(token: symbol) {
    if (current?.token === token) current = null
  }

  function runSpeech(): Promise<TestResult> {
    if (current) return current.promise
    const abort = new AbortController()
    deps.publish({ running: true, stage: 'listening', level: 0, hint: undefined })
    const token = Symbol('speech')
    current = {
      token,
      abort,
      promise: (async () => {
        let outcome: { result: TestResult; cancelled: boolean }
        try {
          outcome = await execute(abort)
        } catch (e) {
          // execute() handles its own failures; this is the "never reject" backstop.
          console.debug('[speech] unexpected error', e)
          const t = deps.now()
          outcome = { result: retryResult(SPEECH_HINTS.backend, t, 0), cancelled: false }
        }
        const { result, cancelled } = outcome
        try {
          if (!cancelled) deps.completeTest(result) // a cancelled run is NOT stored
          const hint = !cancelled && result.needsRetry ? result.flags[0] : undefined
          deps.setHint(hint)
          deps.publish({ running: false, stage: 'idle', level: 0, hint })
        } catch (e) {
          console.debug('[speech] store update failed', e)
        }
        clearIfCurrent(token)
        return result
      })(),
    }
    return current.promise
  }

  return {
    runSpeech,
    cancel: () => current?.abort.abort(),
    get running() {
      return current !== null
    },
  }
}

let shared: SpeechRunner | undefined
/** The shared runner for non-React callers (ElevenLabs client tools). */
export const speechRunner: SpeechRunner = {
  runSpeech: () => (shared ??= createSpeechRunner()).runSpeech(),
  cancel: () => shared?.cancel(),
  get running() {
    return shared?.running ?? false
  },
}

/** React hook: same functions plus `running` for button state. */
export function useSpeechRunner(): Pick<SpeechRunner, 'runSpeech' | 'cancel'> & { running: boolean } {
  const running = useSpeechProgress((s) => s.running)
  return { runSpeech: speechRunner.runSpeech, cancel: speechRunner.cancel, running }
}
