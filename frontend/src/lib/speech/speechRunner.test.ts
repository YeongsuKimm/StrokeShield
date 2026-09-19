import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MIN_CONFIDENCE, SPEECH_TARGET_PHRASE } from '../config'
import type { TestResult } from '../contracts'
import { useSession } from '../session/store'
import { ApiError } from '../resilience/apiErrors'
import { MicError, RecordingCancelled } from './micErrors'
import type { RecordSpeechOptions, SpeechRecording } from './recorder'
import { useSpeechProgress } from './speechProgressStore'
import { cancelSpeechOnPhaseExit, createSpeechRunner, SPEECH_HINTS, type SpeechRunnerDeps } from './speechRunner'

const recording = (over: Partial<SpeechRecording['qc']> = {}): SpeechRecording => ({
  wav: new Blob(['x'], { type: 'audio/wav' }),
  durationS: 3,
  sampleRate: 16000,
  qc: { peak: 0.3, clipping: 0, level: 'ok', speechDetected: true, ...over },
  stopReason: 'silence',
})

const okResult: TestResult = { test: 'speech', severity: 0.2, confidence: 0.9, metrics: { cer: 0.05 }, flags: [], startedAt: 5, durationMs: 100, transcript: 'you cant teach' }

interface Harness {
  deps: SpeechRunnerDeps
  completed: TestResult[]
  hints: (string | undefined)[]
  published: unknown[]
  record: ReturnType<typeof vi.fn<(o: RecordSpeechOptions) => Promise<SpeechRecording>>>
  analyze: ReturnType<typeof vi.fn<(w: Blob, p: string) => Promise<TestResult>>>
  onRecorded: ReturnType<typeof vi.fn<SpeechRunnerDeps['onRecorded']>>
}

function harness(over: Partial<SpeechRunnerDeps> = {}): Harness {
  const completed: TestResult[] = []
  const hints: (string | undefined)[] = []
  const published: unknown[] = []
  const record = vi.fn<(o: RecordSpeechOptions) => Promise<SpeechRecording>>(() => Promise.resolve(recording()))
  const analyze = vi.fn<(w: Blob, p: string) => Promise<TestResult>>(() => Promise.resolve(okResult))
  const onRecorded = vi.fn<SpeechRunnerDeps['onRecorded']>()
  const deps: SpeechRunnerDeps = {
    record,
    analyze,
    completeTest: (r) => void completed.push(r),
    setHint: (h) => void hints.push(h),
    publish: (p) => void published.push(p),
    now: () => 1_700_000_000_000,
    targetPhrase: SPEECH_TARGET_PHRASE,
    onRecorded,
    ...over,
  }
  return { deps, completed, hints, published, record, analyze, onRecorded }
}

const expectRetry = (r: TestResult, flag: string | RegExp) => {
  expect(r.test).toBe('speech')
  expect(r.needsRetry).toBe(true)
  expect(r.severity).toBe(0)
  expect(r.confidence).toBeLessThan(MIN_CONFIDENCE)
  expect(r.startedAt).toBe(1_700_000_000_000)
  expect(r.flags).toHaveLength(1)
  if (typeof flag === 'string') expect(r.flags[0]).toBe(flag)
  else expect(r.flags[0]).toMatch(flag)
}

describe('createSpeechRunner', () => {
  it('happy path: records, analyzes with the target phrase, stores the backend result', async () => {
    const h = harness()
    const runner = createSpeechRunner(h.deps)
    const r = await runner.runSpeech()
    expect(r).toBe(okResult)
    expect(h.analyze).toHaveBeenCalledTimes(1)
    expect(h.analyze.mock.calls[0][1]).toBe(SPEECH_TARGET_PHRASE)
    expect(h.completed).toEqual([okResult])
    expect(h.hints.at(-1)).toBeUndefined()
    expect(h.onRecorded).toHaveBeenCalledTimes(1)
    expect(runner.running).toBe(false)
    expect(h.published).toContainEqual(expect.objectContaining({ stage: 'analyzing' }))
    expect(h.published.at(-1)).toMatchObject({ running: false, stage: 'idle' })
  })

  it('publishes heard=true only once the first audio chunk arrives (so the UI does not ask for speech while the mic is opening)', async () => {
    const h = harness()
    h.record.mockImplementation((o) => {
      expect(h.published.at(-1)).toMatchObject({ stage: 'listening', heard: false })
      o.onLevel?.(0.01)
      o.onLevel?.(0.02)
      return Promise.resolve(recording())
    })
    await createSpeechRunner(h.deps).runSpeech()
    const heardTrue = h.published.filter((p) => (p as { heard?: boolean }).heard === true)
    expect(heardTrue).toHaveLength(1)
    expect(h.published.at(-1)).toMatchObject({ running: false, heard: false })
  })

  it('a muted / dead microphone (pure silence) gets its own message and is not sent to the backend', async () => {
    const h = harness()
    h.record.mockResolvedValue(recording({ speechDetected: false, level: 'too-quiet', peak: 0 }))
    const r = await createSpeechRunner(h.deps).runSpeech()
    expectRetry(r, SPEECH_HINTS.muted)
    expect(SPEECH_HINTS.muted).toMatch(/muted|blocked/)
    expect(h.analyze).not.toHaveBeenCalled()
    // a quiet room with nobody speaking is NOT reported as muted
    const quiet = harness()
    quiet.record.mockResolvedValue(recording({ speechDetected: false, level: 'too-quiet', peak: 0.01 }))
    expectRetry(await createSpeechRunner(quiet.deps).runSpeech(), SPEECH_HINTS.noSpeech)
  })

  it('no speech: retry, not sent to the backend', async () => {
    const h = harness()
    h.record.mockResolvedValue(recording({ speechDetected: false, level: 'too-quiet' }))
    const r = await createSpeechRunner(h.deps).runSpeech()
    expectRetry(r, SPEECH_HINTS.noSpeech)
    expect(h.analyze).not.toHaveBeenCalled()
    expect(h.completed).toEqual([r])
    expect(h.hints.at(-1)).toBe(SPEECH_HINTS.noSpeech)
    expect(h.published.at(-1)).toMatchObject({ hint: SPEECH_HINTS.noSpeech })
  })

  it('too quiet: spoken-style hint, not sent', async () => {
    const h = harness()
    h.record.mockResolvedValue(recording({ level: 'too-quiet', peak: 0.01 }))
    const r = await createSpeechRunner(h.deps).runSpeech()
    expectRetry(r, "I couldn't hear you, please speak louder.")
    expect(h.analyze).not.toHaveBeenCalled()
    expect(h.hints.at(-1)).toBe(r.flags[0])
    expect(h.onRecorded).toHaveBeenCalledTimes(1) // clip still available for calibration
  })

  it('too loud: retry, not sent', async () => {
    const h = harness()
    h.record.mockResolvedValue(recording({ level: 'too-loud', clipping: 0.05 }))
    const r = await createSpeechRunner(h.deps).runSpeech()
    expectRetry(r, SPEECH_HINTS.tooLoud)
    expect(h.analyze).not.toHaveBeenCalled()
  })

  it('mic denied: retry with the mic error text, backend untouched', async () => {
    const h = harness()
    h.record.mockRejectedValue(new MicError('permission-denied'))
    const r = await createSpeechRunner(h.deps).runSpeech()
    expectRetry(r, /microphone.*permission was denied/i)
    expect(h.analyze).not.toHaveBeenCalled()
    expect(h.completed).toEqual([r])
  })

  it('unexpected recorder failure still resolves as a retry', async () => {
    const h = harness()
    h.record.mockRejectedValue(new Error('kaboom'))
    const r = await createSpeechRunner(h.deps).runSpeech()
    expectRetry(r, /microphone/i)
  })

  it('backend error: retry result, stored, hint set', async () => {
    const h = harness()
    h.analyze.mockRejectedValue(new TypeError('Failed to fetch'))
    const r = await createSpeechRunner(h.deps).runSpeech()
    expectRetry(r, SPEECH_HINTS.backend)
    expect(h.completed).toEqual([r])
    expect(h.hints.at(-1)).toBe(SPEECH_HINTS.backend)
  })

  it('backend timeout (AbortError from api.ts): timeout hint', async () => {
    const h = harness()
    h.analyze.mockRejectedValue(new DOMException('This operation was aborted', 'AbortError'))
    const r = await createSpeechRunner(h.deps).runSpeech()
    expectRetry(r, SPEECH_HINTS.timeout)
  })

  it('typed API failures say whether it was the wifi or a slow server, and point at Skip', async () => {
    for (const [kind, hint] of [
      ['timeout', SPEECH_HINTS.timeout],
      ['offline', SPEECH_HINTS.offline],
      ['server', SPEECH_HINTS.backend],
    ] as const) {
      const h = harness()
      h.analyze.mockRejectedValue(new ApiError(kind, 'x'))
      expectRetry(await createSpeechRunner(h.deps).runSpeech(), hint)
    }
    expect(SPEECH_HINTS.backend).toMatch(/skip/i)
    expect(SPEECH_HINTS.timeout).toMatch(/skip/i)
  })

  it('malformed backend response is treated as a backend failure', async () => {
    const h = harness()
    h.analyze.mockResolvedValue({} as TestResult)
    const r = await createSpeechRunner(h.deps).runSpeech()
    expectRetry(r, SPEECH_HINTS.backend)
  })

  it('a backend needsRetry result is stored and its first flag becomes the hint', async () => {
    const h = harness()
    const retry: TestResult = { ...okResult, confidence: 0.1, needsRetry: true, flags: ['audio too noisy'] }
    h.analyze.mockResolvedValue(retry)
    const r = await createSpeechRunner(h.deps).runSpeech()
    expect(r).toBe(retry)
    expect(h.completed).toEqual([retry])
    expect(h.hints.at(-1)).toBe('audio too noisy')
  })

  it('never rejects even if the store throws', async () => {
    const h = harness({
      completeTest: () => {
        throw new Error('store broke')
      },
    })
    await expect(createSpeechRunner(h.deps).runSpeech()).resolves.toBe(okResult)
  })

  it('a throwing calibration hook does not break the run', async () => {
    const h = harness()
    h.onRecorded.mockImplementation(() => {
      throw new Error('disk full')
    })
    await expect(createSpeechRunner(h.deps).runSpeech()).resolves.toBe(okResult)
  })

  it('double call returns the same in-flight promise and records once', async () => {
    const h = harness()
    let release: (r: SpeechRecording) => void = () => {}
    h.record.mockImplementationOnce(() => new Promise<SpeechRecording>((res) => (release = res)))
    const runner = createSpeechRunner(h.deps)
    const a = runner.runSpeech()
    const b = runner.runSpeech()
    expect(b).toBe(a)
    expect(runner.running).toBe(true)
    release(recording())
    await a
    expect(h.record).toHaveBeenCalledTimes(1)
    expect(h.completed).toHaveLength(1)
    expect(runner.running).toBe(false)
    // and a new run afterwards starts fresh
    await runner.runSpeech()
    expect(h.record).toHaveBeenCalledTimes(2)
  })

  it('agent-started request waits until the website button starts and completes recording', async () => {
    const h = harness()
    const runner = createSpeechRunner(h.deps)
    const pending = runner.waitForUserResult()

    await Promise.resolve()
    expect(h.record).not.toHaveBeenCalled()

    const run = runner.runSpeech()
    await Promise.all([pending, run])
    expect(h.record).toHaveBeenCalledTimes(1)
  })

  it('cancel during recording: aborts, resolves Cancelled., nothing stored', async () => {
    const h = harness()
    let seen: AbortSignal | undefined
    h.record.mockImplementation(
      (o) =>
        new Promise<SpeechRecording>((_res, rej) => {
          seen = o.signal
          o.signal?.addEventListener('abort', () => rej(new RecordingCancelled()))
        }),
    )
    const runner = createSpeechRunner(h.deps)
    const p = runner.runSpeech()
    runner.cancel()
    const r = await p
    expect(seen?.aborted).toBe(true)
    expectRetry(r, 'Cancelled.')
    expect(h.completed).toEqual([])
    expect(h.hints.at(-1)).toBeUndefined()
    expect(h.analyze).not.toHaveBeenCalled()
    expect(runner.running).toBe(false)
  })

  it('cancel while analyzing: resolves Cancelled., late backend answer ignored', async () => {
    const h = harness()
    let answer: (r: TestResult) => void = () => {}
    h.analyze.mockImplementation(() => new Promise<TestResult>((res) => (answer = res)))
    const runner = createSpeechRunner(h.deps)
    const p = runner.runSpeech()
    await vi.waitFor(() => expect(h.analyze).toHaveBeenCalled())
    runner.cancel()
    const r = await p
    answer(okResult)
    expectRetry(r, 'Cancelled.')
    expect(h.completed).toEqual([])
  })

  it('cancel with nothing running is a no-op', () => {
    expect(() => createSpeechRunner(harness().deps).cancel()).not.toThrow()
  })

  it('passes a level callback that publishes to the UI', async () => {
    const h = harness()
    h.record.mockImplementation((o) => {
      o.onLevel?.(0.25)
      return Promise.resolve(recording())
    })
    await createSpeechRunner(h.deps).runSpeech()
    expect(h.published).toContainEqual({ level: 0.25, heard: true })
  })
})

describe('default wiring (real stores)', () => {
  beforeEach(() => {
    useSession.getState().reset()
    useSpeechProgress.getState().reset()
  })

  it('completeTest / setHint reach the session store; retry stays on the same phase', async () => {
    useSession.setState({ phase: 'speech' })
    const h = harness()
    h.record.mockRejectedValue(new MicError('no-microphone'))
    const runner = createSpeechRunner({ record: h.record, analyze: h.analyze, onRecorded: h.onRecorded })
    const r = await runner.runSpeech()
    const st = useSession.getState()
    expect(st.results.speech).toEqual(r)
    expect(st.phase).toBe('speech')
    expect(st.hint).toBe(r.flags[0])
    expect(useSpeechProgress.getState()).toMatchObject({ running: false, stage: 'idle', hint: r.flags[0] })
  })

  it('a good result advances speech -> arms', async () => {
    // face and eyes are already done, so arms is the next pending test whatever order / eyes flag is configured
    // (the UI order is Eyes -> Face -> Arms -> Speech with FEATURES.eyesTest on).
    useSession.setState({
      phase: 'speech',
      results: { face: { ...okResult, test: 'face' }, eyes: { ...okResult, test: 'eyes' } },
    })
    const h = harness()
    const runner = createSpeechRunner({ record: h.record, analyze: h.analyze, onRecorded: h.onRecorded })
    await runner.runSpeech()
    expect(useSession.getState().phase).toBe('arms')
  })

  it('cancel() releases an agent request that is still waiting for the button (no hung tool, no muted agent)', async () => {
    const h = harness()
    const runner = createSpeechRunner(h.deps)
    const pending = runner.waitForUserResult()
    runner.cancel()
    const r = await pending
    expectRetry(r, 'Cancelled.')
    expect(h.completed).toEqual([])
    expect(h.record).not.toHaveBeenCalled()
  })
})

describe('cancelSpeechOnPhaseExit', () => {
  const recordingUntilAborted = (h: Harness) =>
    h.record.mockImplementation(
      (o) =>
        new Promise<SpeechRecording>((_res, rej) => {
          o.signal?.addEventListener('abort', () => rej(new RecordingCancelled()))
        }),
    )

  it('skipping / leaving the speech step mid-recording cancels it, so a late result cannot move the flow', async () => {
    useSession.getState().reset()
    useSession.setState({ phase: 'speech' })
    const h = harness()
    recordingUntilAborted(h)
    const runner = createSpeechRunner(h.deps)
    const stop = cancelSpeechOnPhaseExit(runner, () => {})
    const p = runner.runSpeech()
    useSession.setState({ phase: 'clear' }) // patient pressed Skip / Call 911 / the logo
    expectRetry(await p, 'Cancelled.')
    expect(h.completed).toEqual([])
    stop()
  })

  it('leaving speech clears a stale retry hint so the next session does not open on it', () => {
    useSession.getState().reset()
    useSession.setState({ phase: 'speech' })
    const clear = vi.fn()
    const stop = cancelSpeechOnPhaseExit(createSpeechRunner(harness().deps), clear)
    useSession.setState({ phase: 'scoring' })
    expect(clear).toHaveBeenCalledTimes(1)
    stop()
  })

  it('opening the info page mid-recording (phase unchanged) also cancels it', async () => {
    useSession.getState().reset()
    useSession.setState({ phase: 'speech', route: 'home' })
    const h = harness()
    recordingUntilAborted(h)
    const runner = createSpeechRunner(h.deps)
    const stop = cancelSpeechOnPhaseExit(runner, () => {})
    const p = runner.runSpeech()
    useSession.setState({ route: 'info' })
    expectRetry(await p, 'Cancelled.')
    expect(h.completed).toEqual([])
    stop()
    useSession.setState({ route: 'home', phase: 'idle' })
  })

  it('other phase changes (and the isolated ?record=speech page, which stays idle) never cancel', () => {
    useSession.getState().reset()
    const h = harness()
    recordingUntilAborted(h)
    const runner = createSpeechRunner(h.deps)
    const clear = vi.fn()
    const stop = cancelSpeechOnPhaseExit(runner, clear)
    void runner.runSpeech()
    useSession.setState({ phase: 'consent' })
    useSession.setState({ phase: 'face' })
    expect(runner.running).toBe(true)
    expect(clear).not.toHaveBeenCalled()
    runner.cancel()
    stop()
  })
})
