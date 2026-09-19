// OWNER: Frontend/Agent dev. Spec: docs/spec/04-voice-agent.md
// Tool names/params must match the tools registered in the ElevenLabs dashboard exactly.
// Each tool is async and returns a short string the agent can read. NEVER include a verdict.
import { useSession } from '../session/store'
import { testRunner } from '../vision/useTestRunner'
import { recordSpeech } from '../speech/recorder'
import { api } from '../api'

const s = () => useSession.getState()

export const clientTools = {
  start_face_test: async (): Promise<string> => {
    const result = await testRunner.runFace()
    return result.needsRetry ? `Retry needed: ${result.flags[0] || 'face not detected'}` : 'Face test complete. Result recorded.'
  },
  start_arm_test: async (): Promise<string> => {
    const result = await testRunner.runArms()
    return result.needsRetry ? `Retry needed: ${result.flags[0] || 'arms not detected'}` : 'Arm test complete. Result recorded.'
  },
  start_speech_test: async ({ phrase }: { phrase?: string }): Promise<string> => {
    // Agent mic should be muted by the caller (useConversation) before calling this
    try {
      const audioBlob = await recordSpeech()
      // Upload/analyze
      await api.post('/api/speech/analyze', { audio: audioBlob, target_phrase: phrase })
      return 'Speech recorded.'
    } catch (e) {
      return `Retry needed: ${e instanceof Error ? e.message : 'speech recording failed'}`
    }
  },
  record_last_known_well: async ({ description }: { description: string }): Promise<string> => {
    s().setLastKnownWell(description)
    return 'Noted.'
  },
  get_session_status: async (): Promise<string> => {
    const done = Object.keys(s().results).join(', ') || 'none'
    return `Phase: ${s().phase}. Tests completed: ${done}.`
  },
  call_emergency: async ({ reason }: { reason?: string }): Promise<string> => {
    void reason
    s().requestEmergency('user_request')
    return 'Emergency countdown started.'
  },
  cancel_emergency: async (): Promise<string> => {
    s().cancelCountdown()
    return 'Emergency call cancelled.'
  },
}
