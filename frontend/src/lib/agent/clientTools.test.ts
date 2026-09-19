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

import { clientTools, registerAgentMicControl } from './clientTools'

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

  it('a cancelled speech wait gives the microphone back and is not reported as a failed attempt', async () => {
    useSession.setState({ phase: 'speech' })
    const setMuted = vi.fn()
    const off = registerAgentMicControl(setMuted)
    mocks.waitForUserResult.mockResolvedValue(cancelled('speech'))
    const text = await clientTools.start_speech_test()
    expect(setMuted.mock.calls).toEqual([[true], [false]])
    expect(text).not.toMatch(/retry needed|cancelled/i)
    off()
  })
})
