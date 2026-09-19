// OWNER: Frontend/Agent dev. Spec: docs/spec/04-voice-agent.md
// Tool names/params must match the tools registered in the ElevenLabs dashboard exactly.
// Each tool is async and returns a short string the agent can read. NEVER include a verdict.
import { useSession } from '../session/store'

const s = () => useSession.getState()

export const clientTools = {
  // TODO: resolve when the face test finishes (await the vision module), return retry text if needsRetry.
  start_face_test: async (): Promise<string> => 'Face test not implemented yet.',
  start_arm_test: async (): Promise<string> => 'Arm test not implemented yet.',
  start_speech_test: async (): Promise<string> => 'Speech test not implemented yet.',

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
