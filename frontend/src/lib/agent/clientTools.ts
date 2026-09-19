// OWNER: Frontend/Agent dev. Spec: docs/spec/04-voice-agent.md
// Tool names/params must match the tools registered in the ElevenLabs dashboard exactly.
// Each tool is async and returns a short string the agent can read. NEVER include a verdict.
import { useSession } from '../session/store'
import { speechRunner } from '../speech/speechRunner'
import { testRunner } from '../vision/useTestRunner'

const s = () => useSession.getState()

let sendAgentContextualUpdate: ((message: string) => void) | undefined
let speechToolsWaiting = 0

/** True while an agent `start_speech_test` call is waiting for the recording result. */
export const isSpeechToolPending = () => speechToolsWaiting > 0

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

// A cancelled run means the website moved on (skip, emergency, restart): it is not a failed attempt, so do not ask the
// patient to retry it. The contextual update re-states the authoritative phase.
const CANCELLED_FLAG = 'Cancelled.'
const summarize = (result: { needsRetry?: boolean; flags: string[] }, complete: string) =>
  result.flags[0] === CANCELLED_FLAG
    ? 'That check was stopped because the website moved on. Follow the current website phase instead.'
    : result.needsRetry
      ? `Retry needed: ${result.flags[0] ?? 'I could not get a clear recording.'}`
      : complete

// Eye check wording. Neutral in every case: a completed eye check is reported the same way whatever it found (the app's
// risk score decides, never the agent), a failure is already being handled by the website (automatic retry, then Try
// again / Continue without this check), and a skipped check is simply over. None of them invites another tool call.
const summarizeEyes = (result: { needsRetry?: boolean; flags: string[] }): string => {
  if (result.flags[0] === CANCELLED_FLAG) return summarize(result, '')
  if (s().skipped.includes('eyes')) {
    return 'The eye check was skipped and will not be scored. Do not repeat it. Follow the current website phase.'
  }
  if (result.needsRetry) {
    return (
      `The eye check could not get a clear reading (${result.flags[0] ?? 'the eyes were not visible'}). ` +
      'The website retries by itself, then offers the user Try again or Continue without this check. ' +
      'Do not call start_eye_test again. Briefly tell the user what the screen says and wait.'
    )
  }
  return 'Eye check complete. Result recorded.'
}

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
    if (s().skipped.includes('eyes')) return summarizeEyes({ needsRetry: false, flags: [] })
    const blocked = phaseFor('eyes')
    if (blocked) return blocked
    updateAgent('A website test has started. Wait for the tool result before continuing.')
    const result = await testRunner.runEyes()
    updateAgent('A website test has completed. Re-read the authoritative current website phase before speaking.')
    return summarizeEyes(result)
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
    // The agent is silenced and its mic muted by `speechAudioGate` for exactly as long as the recorder runs, so this
    // tool only waits. It stays counted as pending so the gate does not also announce a failed recording.
    speechToolsWaiting++
    try {
      const result = await speechRunner.waitForUserResult()
      updateAgent('A website test has completed. Re-read the authoritative current website phase before speaking.')
      return summarize(result, 'Speech recorded.')
    } finally {
      speechToolsWaiting--
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
