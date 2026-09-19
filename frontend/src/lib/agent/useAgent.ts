// OWNER: Frontend/Agent dev. Spec: docs/spec/04-voice-agent.md
import { useConversation } from '@elevenlabs/react'
import { useEffect, useRef } from 'react'
import { api } from '../api'
import { useSession } from '../session/store'
import { clientTools, registerAgentContextualUpdate, registerAgentMicControl } from './clientTools'

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

	useEffect(() => registerAgentMicControl(conversation.setMuted), [conversation.setMuted])

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
					'The user has connected the voice guide but has not started the website test. Ask if anything feels urgent. If not, immediately tell them to click the Start the test button and wait for that click.',
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
				sendUserMessage(
					'The website is now on the face step. Immediately instruct the user to look at the camera and smile, then call start_face_test. Do not discuss the previous step.',
				)
				return
			}
			if (phase === 'arms') {
				sendUserMessage(
					'The website is now on the arms step. Immediately instruct the user to step back until both hands are visible, then call start_arm_test. Do not discuss the previous step.',
				)
				return
			}
			if (phase === 'clear' || phase === 'alerted' || phase === 'cancelled') {
				const state = useSession.getState()
				const resultSummary = Object.entries(state.results)
					.map(([test, result]) => `${test}: ${result?.needsRetry ? 'could not get a clear reading' : 'recorded'}`)
					.join('; ')
				sendUserMessage(
					`The website has finished the checks. Tell the user the results are complete and summarize them in calm, non-diagnostic language: ${resultSummary || 'no test results were recorded'}. Do not say they do or do not have a stroke.`,
				)
				return
			}
			if (phase === 'countdown' || phase === 'alerting') {
				sendUserMessage(
					'The website has started the emergency process. Tell the user calmly that emergency help is being contacted and remind them they can say cancel during the countdown. Do not summarize test results instead of addressing the emergency.',
				)
				return
			}
		}
		const unsubscribe = useSession.subscribe((state, previous) => {
			if (state.phase !== previous.phase) promptForPhase(state.phase)
		})
		if (status === 'connected') promptForPhase(useSession.getState().phase)
		return () => {
			unregister()
			unsubscribe()
		}
	}, [sendContextualUpdate, sendUserMessage, status])

	const start = async () => {
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
