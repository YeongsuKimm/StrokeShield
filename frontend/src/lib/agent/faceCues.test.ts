import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CaptureProgress } from '../vision/capture'
import { useCaptureProgress } from '../vision/progressStore'
import { bindAgentToFaceCapture, FACE_BRIEFING, SMILE_CUE } from './faceCues'

const progress = (phase: CaptureProgress['phase']) => ({ phase }) as CaptureProgress
const setup = (connected = true) => {
  const send = vi.fn()
  return { send, stop: bindAgentToFaceCapture({ sendUserMessage: send, isConnected: () => connected }) }
}
const capture = useCaptureProgress.getState().set

afterEach(() => useCaptureProgress.setState({ running: null, retryPending: null, progress: null }))

describe('face briefing and smile cue', () => {
  it('the face briefing never uses the word smile (naming it primes the agent to mention it)', () => {
    expect(FACE_BRIEFING).toMatch(/serious, neutral/i)
    expect(FACE_BRIEFING).toMatch(/lips gently closed/i)
    expect(FACE_BRIEFING).not.toMatch(/smil/i)
    expect(FACE_BRIEFING).toMatch(/no other facial instruction/i)
  })

  it('stays quiet while waiting and during the resting-face capture', () => {
    const { send, stop } = setup()
    capture('face', progress('waiting'))
    capture('face', progress('neutral'))
    capture('face', progress('neutral'))
    expect(send).not.toHaveBeenCalled()
    stop()
  })

  it('cues the smile exactly once, when the resting-face capture ends', () => {
    const { send, stop } = setup()
    capture('face', progress('neutral'))
    capture('face', progress('smile'))
    capture('face', progress('smile'))
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(SMILE_CUE)
    stop()
  })

  it('cues again after an automatic retry goes back through the resting face', () => {
    const { send, stop } = setup()
    for (const p of ['neutral', 'smile', 'done', 'waiting', 'neutral', 'smile'] as const) capture('face', progress(p))
    expect(send).toHaveBeenCalledTimes(2)
    stop()
  })

  it('ignores other tests, a disconnected agent, and an unbound listener', () => {
    const arms = setup()
    capture('arms', progress('neutral'))
    capture('arms', progress('smile'))
    expect(arms.send).not.toHaveBeenCalled()
    arms.stop()

    const offline = setup(false)
    capture('face', progress('neutral'))
    capture('face', progress('smile'))
    expect(offline.send).not.toHaveBeenCalled()
    offline.stop()

    const gone = setup()
    gone.stop()
    capture('face', progress('neutral'))
    capture('face', progress('smile'))
    expect(gone.send).not.toHaveBeenCalled()
  })
})
