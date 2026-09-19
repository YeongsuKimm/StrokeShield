import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestResult } from '../contracts'
import { useSession } from '../session/store'

const cancelled = (test: TestResult['test']): TestResult => ({
  test,
  severity: 0,
  confidence: 0,
  metrics: {},
  flags: ['Cancelled.'],
  startedAt: 0,
  durationMs: 0,
  needsRetry: true,
})

const mocks = vi.hoisted(() => ({
  runFace: vi.fn(),
  runEyes: vi.fn(),
  waitForUserResult: vi.fn(),
}))
vi.mock('../vision/useTestRunner', () => ({
  testRunner: { runFace: mocks.runFace, runArms: vi.fn(), runEyes: mocks.runEyes, cancel: vi.fn() },
}))
vi.mock('../speech/speechRunner', () => ({
  speechRunner: { waitForUserResult: mocks.waitForUserResult, runSpeech: vi.fn(), cancel: vi.fn() },
}))

import { clientTools, isSpeechToolPending } from './clientTools'

describe('agent tools when the website moves on mid-test', () => {
  beforeEach(() => {
    useSession.getState().reset()
    mocks.runFace.mockReset()
    mocks.runEyes.mockReset()
    mocks.waitForUserResult.mockReset()
  })

  it('a cancelled vision run is not reported as a failed attempt the patient must retry', async () => {
    useSession.setState({ phase: 'face' })
    mocks.runFace.mockResolvedValue(cancelled('face'))
    const text = await clientTools.start_face_test()
    expect(text).not.toMatch(/retry needed|cancelled/i)
    expect(text).toMatch(/website/i)
  })

  it('a cancelled speech wait is released, not reported as a failed attempt, and is no longer pending', async () => {
    useSession.setState({ phase: 'speech' })
    mocks.waitForUserResult.mockResolvedValue(cancelled('speech'))
    const pending = clientTools.start_speech_test()
    expect(isSpeechToolPending()).toBe(true)
    const text = await pending
    expect(isSpeechToolPending()).toBe(false)
    expect(text).not.toMatch(/retry needed|cancelled/i)
  })
})

describe('start_eye_test wording (neutral, never invites a retry loop)', () => {
  const eyes = (over: Partial<TestResult>): TestResult => ({
    test: 'eyes',
    severity: 0,
    confidence: 0.9,
    metrics: {},
    flags: [],
    startedAt: 0,
    durationMs: 0,
    ...over,
  })
  beforeEach(() => {
    useSession.getState().reset()
    mocks.runEyes.mockReset()
    useSession.setState({ phase: 'eyes' })
  })

  it('a technical failure says what the screen shows and tells the agent NOT to call the tool again', async () => {
    mocks.runEyes.mockResolvedValue(eyes({ needsRetry: true, confidence: 0, flags: ['lost sight of your eyes: face the screen and add light'] }))
    const text = await clientTools.start_eye_test()
    expect(text).toMatch(/lost sight of your eyes/)
    expect(text).toMatch(/do not call start_eye_test again/i)
    expect(text).toMatch(/continue without this check/i)
  })

  it('a completed result with a finding is reported like any other completion: no interpretation', async () => {
    mocks.runEyes.mockResolvedValue(eyes({ severity: 0.5, flags: ['eyes did not follow the dot to the left'] }))
    const text = await clientTools.start_eye_test()
    expect(text).toBe('Eye check complete. Result recorded.')
    expect(text).not.toMatch(/did not follow|stroke|abnormal|deficit/i)
  })

  it('a skipped eye check is over: no rerun, no retry wording', async () => {
    useSession.setState({ skipped: ['eyes'], phase: 'face' })
    const text = await clientTools.start_eye_test()
    expect(mocks.runEyes).not.toHaveBeenCalled()
    expect(text).toMatch(/skipped/i)
    expect(text).not.toMatch(/retry needed/i)
  })

  it('a run cancelled by the patient skipping mid-capture is the neutral "website moved on" text', async () => {
    mocks.runEyes.mockImplementation(async () => {
      useSession.setState({ skipped: ['eyes'], phase: 'face' })
      return eyes({ needsRetry: true, confidence: 0, flags: ['Cancelled.'] })
    })
    const text = await clientTools.start_eye_test()
    expect(text).not.toMatch(/retry needed|cancelled/i)
    expect(text).toMatch(/website/i)
  })
})

