// OWNER: Frontend/Agent dev. Spec: docs/spec/04-voice-agent.md
// Tool names/params must match the tools registered in the ElevenLabs dashboard exactly.
// Each tool is async and returns a short string the agent can read. NEVER include a verdict.
import { useSession } from '../session/store'
import { speechRunner } from '../speech/speechRunner'
import { testRunner } from '../vision/useTestRunner'
import type { TestResult } from '../contracts'

const s = () => useSession.getState()
const summarize = (result: TestResult, complete: string): string =>
  result.needsRetry ? `Retry needed: ${result.flags[0] || 'capture was unclear'}` : complete

export const clientTools = {
  start_face_test: async (): Promise<string> => {
    return summarize(await testRunner.runFace(), 'Face test complete. Result recorded.')
  },
  start_arm_test: async (): Promise<string> => {
    return summarize(await testRunner.runArms(), 'Arm test complete. Result recorded.')
  },
  start_eye_test: async (): Promise<string> => {
    return summarize(await testRunner.runEyes(), 'Eye test complete. Result recorded.')
  },
  start_speech_test: async (_params: { phrase?: string } = {}): Promise<string> => {
    // The shared runner owns recording, QC, upload, result storage, cancellation, and the canonical target phrase.
    return summarize(await speechRunner.runSpeech(), 'Speech test complete. Result recorded.')
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
