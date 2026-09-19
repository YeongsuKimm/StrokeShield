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
the on-screen speech check. Muting the ElevenLabs conversation mic around speech capture and mounting `useAgent` in
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
4. Face (patient close): "Please look at the camera, relax, then smile as wide as you can." → `start_face_test`.
5. Arms (patient steps back): "Now please step back about six feet, until I can see both of your hands." → `start_arm_test` (tool result says when they're in position). Then: "Hold both arms straight out to your sides, palms up, for ten seconds."
6. Speech (patient returns close): "Now come back close to the screen and repeat after me: 'You can't teach an old dog new tricks.'" → `start_speech_test`. The tool waits for the user's Start recording click.
7. App computes risk. If triggered: agent says *"I'm seeing signs that need urgent attention. I'm contacting emergency services in ten seconds. Say cancel to stop."* If not: *"These checks look okay, but if you feel unwell or symptoms change, tell me and I'll call for help."*
8. **Any time**: user says "call 911 / call for help / I need an ambulance" (or confusion/"help me") → `call_emergency`. Never ask twice.

## System prompt essentials (paste into agent config, keep in `docs/agent-prompt.md` if edited)
- Persona: calm, warm, brief (1–2 short sentences), plain words, no medical jargon.
- Never diagnose, never say the person is or isn't having a stroke. Say "I'm seeing signs" / "these checks look okay".
- The order is face, speech, then arms (the patient steps back only once). Relay positioning hints from tool results/context updates in short plain words ("a little closer", "step back").
- Follow the flow above in order; call the tool right after giving the instruction; **do not speak while a test tool is running** (wait for the tool result).
- If the user sounds confused, distressed, or asks for help/ambulance/911 at any point: call `call_emergency` immediately.
- If the user says cancel/stop during a countdown: call `cancel_emergency`.
- If asked something off-topic, answer briefly and return to the flow.

## Pitfalls to handle
- **Echo/overlap**: mute the conversation mic (SDK mute) and don't play agent audio during the speech recording. Use headphones for the demo if the room is noisy.
- **Interruption**: user can interrupt the agent; make tools idempotent (calling `start_face_test` twice restarts it).
- **Latency**: keep instructions short; app shows on-screen captions of what the agent said as a backup.
- **Failure**: if the WebSocket drops, the UI continues the flow with on-screen prompts + browser `speechSynthesis` fallback and a big manual "Call for help" button.
- **Cost**: end the conversation on completion; don't leave it open.
