# 04 — ElevenLabs Voice Agent

Owner: Frontend/Agent dev. Files: `frontend/src/lib/agent/*`, `services/elevenlabs_service.py`, `backend/routers/agent.py`.
Check the current ElevenLabs Agents docs for exact SDK names (`@elevenlabs/react` `useConversation`, `clientTools`, `sendContextualUpdate`, mic mute) — this spec describes intent.

## Role
Calm guide. It **speaks instructions, answers questions, asks last-known-well, and can trigger emergency help**. It **never diagnoses** and never says "you're having a stroke" — the app's risk score decides; the agent relays with hedged language ("I'm seeing signs that need medical attention").

## Setup
1. Create the agent in the ElevenLabs dashboard: voice = calm/clear, LLM = a fast model, first message = short greeting, `turn` settings tuned for short replies.
2. Register **client tools** in the dashboard (names/params must match the frontend exactly).
3. Frontend starts the session with a signed URL from `GET /api/agent/signed-url` (or `VITE_ELEVENLABS_AGENT_ID` if the agent is public). Start on a user gesture (button) — browsers block audio otherwise.
4. Pass dynamic variables (e.g. `patient_name`) at session start.

## Implementation status
The backend signed-URL endpoint, frontend `useAgent` hook, transcript-ready session state, and client tools are
implemented but have not been verified with live ElevenLabs credentials. The speech tool delegates to the shared
`speechRunner`, so it uses the same recording, quality checks, backend analysis, result storage, and cancellation as
the on-screen speech check. If the website moves on while a tool is waiting (skip, emergency, info page), the run is cancelled and the tool returns a neutral "the website moved on" message instead of "Retry needed", and the agent's mic is unmuted. On reconnect the current phase is re-briefed. Muting the ElevenLabs conversation mic around speech capture and mounting `useAgent` in
the application flow still need live integration verification.

## Client tools (implemented in `clientTools.ts`; all async, return a short string the agent can read)
| Tool | Params | Behaviour |
|---|---|---|
| `start_face_test` | — | Runs only while the website is on `face`; waits for the face framing gate, then returns completion or retry text. |
| `start_arm_test` | — | Runs only while the website is on `arms`; waits (up to 12 s) for both hands to be visible, then measures the hold and returns completion or retry text. |
| `start_speech_test` | — | Runs only while the website is on `speech`; waits for the user's **Start recording** click, then returns completion or retry text. It never starts the microphone by itself. |
| `start_eye_test` | — | Runs only while the website is on `eyes` and `FEATURES.eyesTest` is enabled. |
| `record_last_known_well` | `description: string` | Saves free text for the alert |
| `get_session_status` | — | Returns phase + which tests are done (no scores) |
| `call_emergency` | `reason: string` | **User-requested help.** Starts the 10 s countdown immediately (see 05) |
| `cancel_emergency` | — | Cancels an active countdown (user said "cancel/I'm ok") |

The app pushes context to the agent with `sendContextualUpdate` (e.g. `"Risk high; countdown started"`) so it stays in sync.
Every phase change sends an authoritative invalidation; tool completion updates use test-neutral wording so a late result
cannot cause the agent to discuss a previous test. The agent must re-check the latest phase before speaking after a tool result.

## Conversation flow (agent-facing)
1. Greeting + consent reminder → "Are you ready? Let's do a quick check. I'll guide you."
2. Ask **when symptoms started / last time normal** → `record_last_known_well`.
3. Eyes (when enabled, patient close): "Keep your head still and follow the dot with your eyes only." → `start_eye_test`.
4. Face (patient close): "Please look at the camera with a serious, neutral face, lips gently closed, like a passport photo." → `start_face_test`. The agent must NOT ask for the smile until the app says the resting-face capture is complete (`lib/agent/faceCues.ts` sends that cue when the capture goes neutral → smile, once per pass, including after an automatic retry); then "Now smile as wide as you can and hold it." That cue is a user message, which ElevenLabs treats like spoken input: it **interrupts** the agent mid-sentence (checked against the live agent: an `interruption` event arrived within 0.5 s of a text message sent during the greeting), so only one voice speaks. Contextual updates do not interrupt.
5. Arms (patient steps back): "Now please step back about three feet, until I can see both of your hands." → `start_arm_test` (tool result says when they're in position). Then: "Hold both arms straight out to your sides, palms up, for ten seconds."
6. Speech (patient returns close): "Now come back close to the screen and repeat after me: 'You can't teach an old dog new tricks.'" → `start_speech_test`. The tool waits for the user's Start recording click.
7. App computes risk. If triggered: agent says *"I'm seeing signs that need urgent attention. I'm contacting emergency services in ten seconds. Say cancel to stop."* If not: *"Nothing was flagged, but these checks can't rule out a stroke. If you have any symptoms, or they start or change, call 911."*
8. **Any time**: user says "call 911 / call for help / I need an ambulance" (or confusion/"help me") → `call_emergency`. Never ask twice.

## System prompt essentials (paste into agent config, keep in `docs/agent-prompt.md` if edited)
- Persona: calm, warm, brief (1–2 short sentences), plain words, no medical jargon.
- Never diagnose, never say the person is or isn't having a stroke. Say "I'm seeing signs" / "nothing was flagged", and always add that the checks cannot rule out a stroke. Never say the person is fine or all clear. If asked how accurate the check is: it is only a guide through BE-FAST, not clinically accurate, cannot diagnose or rule out a stroke (see "Always be honest about what this is" in `docs/agent-prompt.md`; the live agent prompt must match).
- The order is face, speech, then arms (the patient steps back only once). Relay positioning hints from tool results/context updates in short plain words ("a little closer", "step back").
- Follow the flow above in order; call the tool right after giving the instruction; **do not speak while a test tool is running** (wait for the tool result).
- If the user sounds confused, distressed, or asks for help/ambulance/911 at any point: call `call_emergency` immediately.
- If the user says cancel/stop during a countdown: call `cancel_emergency`.
- If asked something off-topic, answer briefly and return to the flow.

## Regression probe
`python scripts/agent_probe.py` (needs `.env` keys) opens short text-only conversations with the LIVE agent and asserts: face briefing has no smile mention and says serious/neutral, smile cue says smile, accuracy answer (not clinically accurate, cannot diagnose), no false reassurance on a "nothing flagged" result, emergency phrase -> `call_emergency`, aspirin -> no, and no phone number except 911 / 1-888-4-STROKE. `--tools` checks that `docs/agent-tools/*.json`, `clientTools.ts` and the live agent's client tools agree. Read-only on the agent; assertion helpers are unit-tested offline (`tests/test_agent_probe.py`). The app also tells the agent when the alert text failed or was only a demo (`useAgent.ts`).

## Pitfalls to handle
- **Echo/overlap**: while the speech recorder runs (from the moment Start recording is pressed, even if the agent is mid-sentence or has not called the tool yet) `lib/agent/speechAudioGate.ts` sets agent playback volume to 0 and mutes the conversation mic, then restores both when the run ends or is cancelled. If the recording was unusable and no `start_speech_test` call is waiting, the agent is told to report it and ask for another try; otherwise the tool result / next-phase brief makes it speak again. Use headphones for the demo if the room is noisy.
- **Interruption**: user can interrupt the agent; make tools idempotent (calling `start_face_test` twice restarts it).
- **Latency**: keep instructions short; app shows on-screen captions of what the agent said as a backup.
- **Failure**: if the WebSocket drops, the UI continues the flow with on-screen prompts + browser `speechSynthesis` fallback and a big manual "Call for help" button.
- **Cost**: end the conversation on completion; don't leave it open.

## Stroke knowledge (only when asked)
The agent prompt carries a short "Stroke facts" section (`docs/agent-prompt.md`): BE-FAST signs, call 911 even if signs pass, do not drive, time matters (tell the dispatcher when the person was last well), what to do while waiting (no food, drink or aspirin unless the dispatcher says), and the American Stroke Association warmline 1-888-4-STROKE (non-emergency, weekdays). Sources: CDC stroke signs page, NHS stroke symptoms page, AHA/Red Cross first-aid guidance, ASA warmline listing. Rules: answer only when asked, in one or two short sentences, then return to the current step; no diagnosis, no medicine or recovery advice; the only numbers it may say are 911 and the warmline. It lives in the prompt (not a knowledge base) so it adds no retrieval latency. Re-apply it if the agent is recreated.

