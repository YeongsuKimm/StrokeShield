// The face check has two captures: a resting face, then a smile. The agent must not ask for the smile until the
// resting-face capture is complete, so the app (which knows the capture phase) cues it, instead of the agent guessing.
// Spec: docs/spec/04-voice-agent.md
import { useCaptureProgress } from '../vision/progressStore'

export const FACE_BRIEFING =
  'The website is now on the face step. Immediately tell the user to look at the camera and hold a serious, neutral expression with their lips gently closed, like a passport photo: no smile, and mouth not stretched wide. Then call start_face_test. Do NOT mention smiling yet: the website will tell you the moment the resting-face check is complete and it is time to smile. Do not discuss the previous step.'

export const SMILE_CUE =
  'The serious-face check is now complete. Tell the user, in one short sentence, to smile as wide as they can and hold it. Do not describe results.'

export interface FaceCueDeps {
  sendUserMessage: (message: string) => void
  isConnected: () => boolean
}

/** Returns an unsubscribe function. Fires the smile cue once per resting-face -> smile transition of a face run. */
export function bindAgentToFaceCapture(deps: FaceCueDeps): () => void {
  return useCaptureProgress.subscribe((state, previous) => {
    const was = previous.running === 'face' ? previous.progress?.phase : undefined
    const now = state.running === 'face' ? state.progress?.phase : undefined
    if (was === 'neutral' && now === 'smile' && deps.isConnected()) deps.sendUserMessage(SMILE_CUE)
  })
}
