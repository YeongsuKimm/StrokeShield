# Kickoff prompts

Paste the prompt for your role into your AI agent (Claude Code, Codex, Gemini CLI…) at the start of a session.
The agent reads `AGENTS.md` automatically; these prompts point it at your module's spec and fence it into your files.

## Before you start (everyone, ~10 min)
1. `git pull`, create your branch: `git checkout -b <role>/<task>` (e.g. `vision/face-metrics`).
2. Set up `.env` (copy `.env.example`, get keys from the team lead) and install backend + frontend deps (see README).
3. Confirm the baseline is green: `pytest` and `cd frontend && pnpm test && pnpm typecheck`.
4. Run the app with `?demo=1` and click **Simulate stroke** to see the end-to-end flow with fake results.

## General rules for every prompt
- Ask the agent to **propose a short plan first** and wait for your OK on anything bigger than a small change.
- Tests before/with code. Metric and scoring code must be pure functions.
- Stay in your files. If you need a contract change (`contracts.ts` / `schemas.py`), stop and tell the team.
- Ask it to check current official docs for MediaPipe / ElevenLabs / Twilio instead of trusting memory.
- Commit small, prefix with your module (`vision:`, `speech:`, `agent:`, `alert:`, `ui:`), open a PR to `main`.

---

## A. Frontend + Agent lead
> Read AGENTS.md, docs/spec/04-voice-agent.md and docs/spec/06-frontend-ux.md. The state machine (`frontend/src/lib/session/store.ts`), dashboard, countdown modal and demo panel exist as a skeleton. First propose a plan, then: (1) build the camera view with mirrored video, a landmark overlay canvas and instruction captions, keeping per-frame work out of React state; (2) implement `frontend/src/lib/agent/useAgent.ts` with the ElevenLabs Agents SDK (`@elevenlabs/react`), signed-URL start on a user gesture, client tools from `clientTools.ts`, mic mute during the speech test; (3) make the tool stubs `start_face_test` / `start_arm_test` / `start_speech_test` await the real test modules. Only edit `frontend/src/components`, `frontend/src/App.tsx`, `frontend/src/lib/agent`, `frontend/src/lib/session`, and `backend/routers/agent.py` + `services/elevenlabs_service.py` (signed URL). Also create the ElevenLabs agent in the dashboard using the prompt and tool list in the spec.

## B. Vision
> Read AGENTS.md and docs/spec/02-vision.md. Propose a plan, then implement, test-first, the pure functions `analyzeFace` (`frontend/src/lib/vision/face.ts`) and `analyzeArms` (`arms.ts`) returning a `TestResult`, with Vitest tests on synthetic landmark fixtures (symmetric smile, left droop, right droop, head rolled 20°, low confidence; arms steady / one drops / both drop / one never rises). Then write `useMediaPipe.ts` that runs FaceLandmarker + PoseLandmarker on the webcam with models loaded from `frontend/public/models/`, and a debug overlay to verify landmark left/right mapping (record the verified mapping in a comment in `landmarks.ts`). Only edit `frontend/src/lib/vision/`. Second opinion via Anthropic (`models/vision.py`) is a stretch — do it last.

## C. Speech
> Read AGENTS.md and docs/spec/03-speech.md. Propose a plan, then implement, test-first: (1) `frontend/src/lib/speech/recorder.ts` capturing 16 kHz mono PCM16 WAV with echoCancellation/noiseSuppression/autoGainControl off and auto-stop on trailing silence; (2) `models/audio.py` — QC, ElevenLabs Scribe transcription via `services/elevenlabs_service.py` (check current docs for the STT API), CER/WER, temporal features, Parselmouth acoustic features, weighted severity from `models/config.py`; use synthetic-signal pytest tests and mock the Scribe call. Then build the calibration script and record normal vs simulated-slurred fixtures. Only edit `frontend/src/lib/speech/`, `models/`, `services/elevenlabs_service.py`, `backend/routers/speech.py`, `tests/`.

## D. Backend + Alerts + Deploy
> Read AGENTS.md and docs/spec/05-risk-and-alerts.md. The alert path (`services/twilio_service.py`, `backend/routers/alert.py`) and `risk.ts` exist with tests. Propose a plan, then: (1) verify a real call + SMS to the demo number end-to-end with `DRY_RUN=false` on your machine (Twilio trial: number must be verified; expect the trial preamble); (2) improve the spoken/SMS message and TwiML; (3) write a `Dockerfile` and Railway config for the backend (opencv/libsndfile system libs, `ALLOWED_ORIGINS`), and Vercel config for `frontend/`; (4) add `/api/health` checks and logging without PII. Never weaken the safety guards in AGENTS.md rule 1. Only edit `services/twilio_service.py`, `backend/`, `tests/test_alert.py`, `frontend/src/lib/risk.ts` + config, deployment files.

---

## Reviewing an agent's diff (you, before merging)
- [ ] No secrets or real phone numbers in the diff.
- [ ] `contracts.ts` / `schemas.py` unchanged (or changed in both, with team heads-up).
- [ ] No new dependency without a reason; no unrelated refactors.
- [ ] Nothing can send to a number that isn't `DEMO_PHONE_NUMBER`.
- [ ] Tests exist and pass; low-confidence/failure paths handled.
