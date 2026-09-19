// OWNER: Frontend/Agent dev. Spec: docs/spec/04-voice-agent.md
import { useConversation } from '@elevenlabs/react'
import { useEffect, useRef } from 'react'
import { api } from '../api'
import { useSession } from '../session/store'
import { clientTools, isSpeechToolPending, registerAgentContextualUpdate } from './clientTools'
import { registerAgentEnd } from './agentSession'
import { bindAgentToFaceCapture, FACE_BRIEFING } from './faceCues'
import { bindAgentToSpeechRecording } from './speechAudioGate'

type AgentMessage = { message?: string; source?: string }

export function useAgent() {
	const setAgentConnected = useSession((s) => s.setAgentConnected)
	const addTranscript = useSession((s) => s.addTranscript)
	const lastPromptedPhase = useRef<string | null>(null)
	const conversation = useConversation({
		clientTools,
		onConnect: () => setAgentConnected(true),
		onDisconnect: () => setAgentConnected(false),
		onMessage: (message: AgentMessage) => {
			const text = message.message?.trim()
			if (!text) return
			addTranscript(message.source === 'user' ? 'patient' : 'agent', text)
		},
		onError: (error) => console.debug('[agent] conversation error', error),
	})

	// Silence the agent (and mute the patient's mic towards it) for as long as the speech recorder runs, then bring it
	// back; if the recording was unusable and no tool call is waiting to say so, the agent tells the patient.
	const latest = useRef(conversation)
	useEffect(() => {
		latest.current = conversation
	})
	// Let "Clear my data" hang up the guide from outside React.
	useEffect(() => {
		registerAgentEnd(() => latest.current.endSession())
		return () => registerAgentEnd(null)
	}, [])
	useEffect(
		() =>
			bindAgentToSpeechRecording({
				setVolume: (volume) => latest.current.setVolume({ volume }),
				setMuted: (muted) => latest.current.setMuted(muted),
				isMuted: () => latest.current.isMuted,
				toolPending: isSpeechToolPending,
				onRetryNeeded: (hint) => {
					if (latest.current.status !== 'connected') return
					latest.current.sendUserMessage(
						`The speech recording could not be used (${hint}). Tell the user briefly and kindly, then ask them to press Start recording and say the sentence again.`,
					)
				},
			}),
		[],
	)

	// Read the members once so the effect depends on exactly what it uses (same values the closure saw before).
	const { status, sendContextualUpdate, sendUserMessage } = conversation

	useEffect(() => {
		// A new conversation knows nothing about the step the website is on: forget what the last one was told, so
		// reconnecting mid-test re-briefs the agent instead of leaving it silent.
		if (status !== 'connected') lastPromptedPhase.current = null
		const unregister = registerAgentContextualUpdate(sendContextualUpdate)
		const promptForPhase = (phase: string) => {
			if (status !== 'connected') return
			if (lastPromptedPhase.current === phase) return
			lastPromptedPhase.current = phase
			sendContextualUpdate(
				`AUTHORITATIVE WEBSITE STATE ${phase}: this is the only active step. Discard all prior test instructions and results. Do not mention any other test.`,
			)
			if (phase === 'idle') {
				sendUserMessage(
					'The user has connected the voice guide but has not started the website test. Ask if anything feels urgent. If not, immediately tell them to click the Start the check button and wait for that click.',
				)
				return
			}
			if (phase === 'speech') {
				sendUserMessage(
					'The website is now on the final speech step. Immediately instruct the user to return close to the screen and repeat the displayed sentence, then call start_speech_test. The tool waits for the user to click Start recording.',
				)
				return
			}
			if (phase === 'eyes') {
				sendUserMessage(
					'The website is now on the eyes step. Immediately instruct the user to keep their head still and follow the dot, then call start_eye_test. Do not discuss the previous step.',
				)
				return
			}
			if (phase === 'face') {
				sendUserMessage(FACE_BRIEFING)
				return
			}
			if (phase === 'arms') {
				sendUserMessage(
					'The website is now on the arms step. Immediately instruct the user to keep stepping back until both hands are visible, then call start_arm_test. Do not discuss the previous step.',
				)
				return
			}
			if (phase === 'clear' || phase === 'alerted' || phase === 'cancelled') {
				const state = useSession.getState()
				const resultSummary = Object.entries(state.results)
					.map(([test, result]) => `${test}: ${result?.needsRetry ? 'could not get a clear reading' : 'recorded'}`)
					.join('; ')
				sendUserMessage(
					`The website has finished the checks. Tell the user the results are complete and summarize them in calm, non-diagnostic language: ${resultSummary || 'no test results were recorded'}. Do not say they do or do not have a stroke, and never say they are fine. Say briefly that this guide is not clinically accurate and cannot rule out a stroke, and that they should call 911 if they have any symptoms or if symptoms start or change.`,
				)
				return
			}
			if (phase === 'countdown') {
				sendUserMessage(
					'The website has started a countdown to text the demo phone (a text message, not emergency services). Tell the user calmly, remind them they can say cancel, and that they can call 911 themselves at any time. Do not summarize test results instead of addressing this.',
				)
				return
			}
			if (phase === 'alerting') return // the outcome (sent / demo / failed) is announced from the alert status below
		}
		// Honest outcome of the text: never let the guide claim help was contacted when nothing went out.
		const promptForAlertStatus = (status: string, dryRun: boolean) => {
			if (status === 'failed') {
				sendUserMessage(
					'The text to the demo phone did NOT go through. Tell the user plainly, and tell them to call 911 themselves now. The screen has a button to try sending again. Do not say help is on the way.',
				)
			} else if (status === 'sent' && dryRun) {
				sendUserMessage(
					'This is demo mode: no text message was actually sent. Say so plainly, and that in a real emergency they should call 911.',
				)
			}
		}
		const unsubscribe = useSession.subscribe((state, previous) => {
			if (state.phase !== previous.phase) promptForPhase(state.phase)
			if (state.alertStatus !== previous.alertStatus) promptForAlertStatus(state.alertStatus, state.alertResponse?.dryRun === true)
		})
		if (status === 'connected') promptForPhase(useSession.getState().phase)
		return () => {
			unregister()
			unsubscribe()
		}
	}, [sendContextualUpdate, sendUserMessage, status])

	// The smile is only requested once the app reports the resting-face capture is complete.
	useEffect(
		() =>
			bindAgentToFaceCapture({
				sendUserMessage: (message) => latest.current.sendUserMessage(message),
				isConnected: () => latest.current.status === 'connected',
			}),
		[],
	)

	const start = async () => {
		// Consent gate: nothing contacts the backend or ElevenLabs, or opens the microphone, without the voice opt-in.
		if (!useSession.getState().voiceConsent) return
		const { signedUrl } = await api.signedUrl()
		await conversation.startSession({ signedUrl })
	}

	return {
		start,
		end: conversation.endSession,
		status: conversation.status,
		isMuted: conversation.isMuted,
		setMuted: conversation.setMuted,
	}
}
