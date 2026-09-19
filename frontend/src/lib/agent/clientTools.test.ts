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
  waitForUserResult: vi.fn(),
}))
vi.mock('../vision/useTestRunner', () => ({
  testRunner: { runFace: mocks.runFace, runArms: vi.fn(), runEyes: vi.fn(), cancel: vi.fn() },
}))
vi.mock('../speech/speechRunner', () => ({
  speechRunner: { waitForUserResult: mocks.waitForUserResult, runSpeech: vi.fn(), cancel: vi.fn() },
}))

import { clientTools, isSpeechToolPending } from './clientTools'

describe('agent tools when the website moves on mid-test', () => {
  beforeEach(() => {
    useSession.getState().reset()
    mocks.runFace.mockReset()
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
