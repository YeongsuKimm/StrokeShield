// Keeps the voice agent quiet while the patient's speech is being recorded. Driven by the recorder's own state (not by the
// agent's `start_speech_test` tool), so it also works when the patient presses Start recording before the agent has
// finished talking or has called the tool. Spec: docs/spec/04-voice-agent.md
import { useSpeechProgress } from '../speech/speechProgressStore'

export interface SpeechAudioGateDeps {
  /** Agent playback volume, 0..1. */
  setVolume: (volume: number) => void
  /** Mute / unmute the patient's microphone towards the agent. */
  setMuted: (muted: boolean) => void
  isMuted: () => boolean
  /** True while an agent `start_speech_test` call is waiting for the result (it will speak the retry itself). */
  toolPending: () => boolean
  /** The recording ended unusable and nobody else will tell the patient: the agent should. */
  onRetryNeeded: (hint: string) => void
}

const swallow = (fn: () => void) => {
  try {
    fn()
  } catch (e) {
    // The conversation may already be closed; there is nothing to silence then.
    console.debug('[agent] speech gate ignored', e)
  }
}

/** Returns an unsubscribe function that also restores the agent's audio. */
export function bindAgentToSpeechRecording(deps: SpeechAudioGateDeps): () => void {
  let silenced = false
  let mutedBefore = false

  const silence = () => {
    if (silenced) return
    silenced = true
    mutedBefore = deps.isMuted()
    swallow(() => deps.setVolume(0))
    swallow(() => deps.setMuted(true))
  }
  const restore = () => {
    if (!silenced) return
    silenced = false
    swallow(() => deps.setVolume(1))
    swallow(() => deps.setMuted(mutedBefore))
  }

  if (useSpeechProgress.getState().running) silence()
  const unsubscribe = useSpeechProgress.subscribe((state, previous) => {
    if (state.running === previous.running) return
    if (state.running) return silence()
    restore()
    if (state.hint && !deps.toolPending()) deps.onRetryNeeded(state.hint)
  })

  return () => {
    unsubscribe()
    restore()
  }
}
