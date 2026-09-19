// OWNER: Frontend/Agent dev. Spec: docs/spec/04-voice-agent.md
// Tool names/params must match the tools registered in the ElevenLabs dashboard exactly.
// Each tool is async and returns a short string the agent can read. NEVER include a verdict.
import { useSession } from '../session/store'
import { speechRunner } from '../speech/speechRunner'
import { testRunner } from '../vision/useTestRunner'

const s = () => useSession.getState()

let setAgentMicMuted: ((muted: boolean) => void) | undefined
let sendAgentContextualUpdate: ((message: string) => void) | undefined

export const registerAgentMicControl = (setMuted: (muted: boolean) => void) => {
  setAgentMicMuted = setMuted
  return () => {
    if (setAgentMicMuted === setMuted) setAgentMicMuted = undefined
  }
}

export const registerAgentContextualUpdate = (send: (message: string) => void) => {
  sendAgentContextualUpdate = send
  return () => {
    if (sendAgentContextualUpdate === send) sendAgentContextualUpdate = undefined
  }
}

const updateAgent = (message: string) => sendAgentContextualUpdate?.(`App update: ${message}`)

const phaseFor = (test: 'speech' | 'eyes' | 'face' | 'arms') => {
  const phase = s().phase
  if (phase !== test) {
    return `Please wait for the website. The user must click Start the test before the ${test} check can run.`
  }
  return undefined
}

const summarize = (result: { needsRetry?: boolean; flags: string[] }, complete: string) =>
  result.needsRetry ? `Retry needed: ${result.flags[0] ?? 'I could not get a clear recording.'}` : complete

export const clientTools = {
  start_face_test: async (): Promise<string> => {
    const blocked = phaseFor('face')
    if (blocked) return blocked
    updateAgent('A website test has started. Wait for the tool result before continuing.')
    const result = await testRunner.runFace()
    updateAgent('A website test has completed. Re-read the authoritative current website phase before speaking.')
    return summarize(result, 'Face test complete. Result recorded.')
  },
  start_eye_test: async (): Promise<string> => {
    const blocked = phaseFor('eyes')
    if (blocked) return blocked
    updateAgent('A website test has started. Wait for the tool result before continuing.')
    const result = await testRunner.runEyes()
    updateAgent('A website test has completed. Re-read the authoritative current website phase before speaking.')
    return summarize(result, 'Eye test complete. Result recorded.')
  },
  start_arm_test: async (): Promise<string> => {
    const blocked = phaseFor('arms')
    if (blocked) return blocked
    updateAgent('A website test has started. Wait for the tool result before continuing.')
    const result = await testRunner.runArms()
    updateAgent('A website test has completed. Re-read the authoritative current website phase before speaking.')
    return summarize(result, 'Arm test complete. Result recorded.')
  },
  start_speech_test: async (): Promise<string> => {
    const blocked = phaseFor('speech')
    if (blocked) return blocked
    updateAgent('A website test has started. Wait for the tool result before continuing.')
    setAgentMicMuted?.(true)
    try {
      const result = await speechRunner.waitForUserResult()
      updateAgent('A website test has completed. Re-read the authoritative current website phase before speaking.')
      return summarize(result, 'Speech recorded.')
    } finally {
      setAgentMicMuted?.(false)
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
