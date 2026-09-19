import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSpeechProgress } from '../speech/speechProgressStore'
import { bindAgentToSpeechRecording } from './speechAudioGate'

const setup = (over: { muted?: boolean; toolPending?: boolean } = {}) => {
  const deps = {
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    isMuted: vi.fn(() => over.muted ?? false),
    toolPending: vi.fn(() => over.toolPending ?? false),
    onRetryNeeded: vi.fn(),
  }
  return { deps, stop: bindAgentToSpeechRecording(deps) }
}

afterEach(() => useSpeechProgress.setState({ running: false, stage: 'idle', level: 0, hint: undefined }))

describe('bindAgentToSpeechRecording', () => {
  it('silences the agent the moment recording starts, even with no agent tool call', () => {
    const { deps, stop } = setup()
    useSpeechProgress.getState().set({ running: true, stage: 'listening' })
    expect(deps.setVolume).toHaveBeenLastCalledWith(0)
    expect(deps.setMuted).toHaveBeenLastCalledWith(true)
    stop()
  })

  it('brings the agent back when the run ends and restores the previous mute state', () => {
    const { deps, stop } = setup({ muted: true })
    useSpeechProgress.getState().set({ running: true })
    useSpeechProgress.getState().set({ running: false, stage: 'idle' })
    expect(deps.setVolume).toHaveBeenLastCalledWith(1)
    expect(deps.setMuted).toHaveBeenLastCalledWith(true)
    expect(deps.onRetryNeeded).not.toHaveBeenCalled()
    stop()
  })

  it('stays silent across listening -> analyzing updates and only restores once', () => {
    const { deps, stop } = setup()
    useSpeechProgress.getState().set({ running: true, stage: 'listening' })
    useSpeechProgress.getState().set({ stage: 'analyzing' })
    useSpeechProgress.getState().set({ level: 0.4 })
    expect(deps.setVolume).toHaveBeenCalledTimes(1)
    useSpeechProgress.getState().set({ running: false })
    expect(deps.setVolume).toHaveBeenCalledTimes(2)
    stop()
    expect(deps.setVolume).toHaveBeenCalledTimes(2)
  })

  it('asks the agent to report an unusable recording only when no tool call is waiting to do it', () => {
    const idle = setup()
    useSpeechProgress.getState().set({ running: true })
    useSpeechProgress.getState().set({ running: false, hint: 'No speech heard' })
    expect(idle.deps.onRetryNeeded).toHaveBeenCalledWith('No speech heard')
    idle.stop()

    useSpeechProgress.setState({ running: false, hint: undefined })
    const waiting = setup({ toolPending: true })
    useSpeechProgress.getState().set({ running: true })
    useSpeechProgress.getState().set({ running: false, hint: 'No speech heard' })
    expect(waiting.deps.onRetryNeeded).not.toHaveBeenCalled()
    waiting.stop()
  })

  it('handles a recording already in progress at bind time, and restores on unmount', () => {
    useSpeechProgress.getState().set({ running: true })
    const { deps, stop } = setup()
    expect(deps.setVolume).toHaveBeenLastCalledWith(0)
    stop()
    expect(deps.setVolume).toHaveBeenLastCalledWith(1)
  })

  it('survives a closed conversation (setVolume throws)', () => {
    const { deps, stop } = setup()
    deps.setVolume.mockImplementation(() => {
      throw new Error('closed')
    })
    expect(() => useSpeechProgress.getState().set({ running: true })).not.toThrow()
    expect(deps.setMuted).toHaveBeenCalledWith(true)
    stop()
  })
})
