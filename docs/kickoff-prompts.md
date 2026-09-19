# Kickoff prompts

Paste the prompt for your role into your AI agent (Claude Code, Codex, Gemini CLI…) at the start of a session.
The agent reads `AGENTS.md` automatically; these prompts point it at your module's spec and fence it into your files.

Roles below are a starting suggestion: ownership is fluid. Claim a row in `docs/STATUS.md`, and "only edit these files" means the files your task names. If someone else is in the same file, coordinate in chat and pull often. Full onboarding: [GETTING-STARTED.md](GETTING-STARTED.md).

## Before you start (everyone, ~10 min)
0. Run `bash scripts/setup-hooks.sh` once (enables the docs/context pre-push check).
1. `git pull`, create your branch: `git checkout -b <role>/<task>` (e.g. `vision/face-metrics`).
2. Set up `.env` (copy `.env.example`, get keys from the team lead) and install backend + frontend deps (see README).
3. Confirm the baseline is green: `pytest` and `cd frontend && pnpm test && pnpm typecheck`.
4. Run the app with `?demo=1` and click **Simulate stroke** to see the end-to-end flow with fake results.

## General rules for every prompt
- **Context:** start with "Read AGENTS.md and docs/STATUS.md"; finish with "Update docs/STATUS.md (my row + recent changes) and any spec my change made wrong, then tell me what you updated." The pre-push hook and CI fail code pushes that skip STATUS.
- Ask the agent to **propose a short plan first** and wait for your OK on anything bigger than a small change.
- Tests before/with code. Metric and scoring code must be pure functions.
- Stay in your files. If you need a contract change (`contracts.ts` / `schemas.py`), stop and tell the team.
- Ask it to check current official docs for MediaPipe / ElevenLabs / Twilio instead of trusting memory.
- Commit small, prefix with your module (`vision:`, `speech:`, `agent:`, `alert:`, `ui:`), open a PR to `main`.

---

## A. Frontend + Agent lead
> Read AGENTS.md, docs/spec/04-voice-agent.md and docs/spec/06-frontend-ux.md. The state machine (`frontend/src/lib/session/store.ts`), dashboard, countdown modal and demo panel exist as a skeleton. First propose a plan, then: (1) build the camera view with mirrored video, a landmark overlay canvas and instruction captions, keeping per-frame work out of React state; (2) implement `frontend/src/lib/agent/useAgent.ts` with the ElevenLabs Agents SDK (`@elevenlabs/react`), signed-URL start on a user gesture, client tools from `clientTools.ts`, mic mute during the speech test; (3) make the tool stubs `start_face_test` / `start_arm_test` / `start_speech_test` await the real test modules. Only edit `frontend/src/components`, `frontend/src/App.tsx`, `frontend/src/lib/agent`, `frontend/src/lib/session`, and `backend/routers/agent.py` + `services/elevenlabs_service.py` (signed URL). Also create the ElevenLabs agent in the dashboard using the prompt and tool list in the spec.

## B. Vision
> Read AGENTS.md, docs/STATUS.md and docs/spec/02-vision.md (esp. "Shared conventions"). The pure analyzers `analyzeFace`, `analyzeArms`, `analyzeEyes` (+ `EyeStimulus`, framing gates, capture/runtime) already exist with tests: do NOT reimplement them. Propose a plan for what's left, then do it test-first: (1) live-camera verification of the left/right mapping using `?debug=1` (face landmarks/blendshapes, arms 11/13/15, eye landmarks) and fix `FACE_CONFIG.blendshapeLeftIsPatientLeft` / `ARMS_CONFIG.swapLeftRight` accordingly; (2) collect recordings with `?record=1` and tune thresholds with `pnpm calibrate` following docs/CALIBRATION.md so healthy ≤ 0.15, borderline ≈ 0.35, clear ≥ 0.85 with correct sides (`vision/consistency.test.ts` must stay green); (3) wire the eyes test (`runEyes`, stimulus, `start_eye_test`) behind `FEATURES.eyesTest`; (4) stretch: Claude second opinion (`models/vision.py`). Edit only `frontend/src/lib/vision/`, `frontend/src/components/EyeStimulus.tsx`, `models/vision.py`; update `docs/STATUS.md` and spec 02 with any value you change.

## C. Speech
> Read AGENTS.md, docs/STATUS.md and docs/spec/03-speech.md (esp. "As built"). The core analysis, phoneme scoring, browser recorder, calibration CLI and hardened endpoint already exist with tests: do NOT reimplement them. Propose a plan for what's left, then do it: (1) manual real-mic verification of the recorder (checklist: mic prompt, level meter, auto-stop after ~1.2 s silence, valid 16 kHz mono WAV, echo-cancellation flags honored via `track.getSettings()`, whisper/shout/no-speech hints, cancel); (2) collect real recordings with `?record=1` following docs/CALIBRATION.md (speech section) and tune `models/config.py` with `python -m models.calibrate` so healthy ≤ 0.15, borderline 0.2–0.55, clear ≥ 0.85, watching noise/accent false alarms; (3) when ElevenLabs is un-paused: implement `scribe(wav_bytes) -> Transcript | None` in `services/elevenlabs_service.py`, pass it as the `transcriber`, and have `start_speech_test` call `speechRunner.runSpeech()` with the agent mic muted. Update docs/STATUS.md and spec 03 with any value you change.

## D. Backend + Alerts + Deploy
> Read AGENTS.md and docs/spec/05-risk-and-alerts.md. The alert path (`services/twilio_service.py`, `backend/routers/alert.py`) and `risk.ts` exist with tests. Propose a plan, then: (1) verify one real SMS to the demo number end-to-end with `DRY_RUN=false` on your machine (Twilio trial: the number may need verification); (2) improve the SMS message; (3) write a `Dockerfile` and Railway config for the backend (opencv/libsndfile system libs, `ALLOWED_ORIGINS`), and Vercel config for `frontend/`; (4) add `/api/health` checks and logging without PII. Never weaken the safety guards in AGENTS.md rule 1. Only edit `services/twilio_service.py`, `backend/`, `tests/test_alert.py`, `frontend/src/lib/risk.ts` + config, deployment files.

---

## Stretch prompts (only after the FAST MVP is demo-stable and merged)

**Eyes test (Vision dev):**
> Read AGENTS.md and docs/spec/02-vision.md, section "Eyes test". Propose a plan, then implement `frontend/src/lib/vision/eyes.ts` as pure functions with fixture tests (gaze palsy left/right, dysconjugate, centered, head-turned, low confidence), a moving-dot stimulus component, and the debug overlay for iris landmarks. Keep it behind `FEATURES.eyesTest`; coordinate with the Agent dev for the `start_eye_test` tool. Don't change contracts.

**Phoneme scoring (Speech dev):**
> Read AGENTS.md and docs/spec/03-speech.md, section "Stretch: phoneme-level scoring". Propose a plan, then implement it behind `PHONEME_SCORING`, with torch/transformers imported lazily and listed only in a new `requirements-ml.txt`. Verify the model id and license first, hardcode the target phoneme sequence, and validate on the normal vs simulated-slurred fixtures. The endpoint must still work with the flag off.

**Backend dev note:** run the demo backend on the laptop with `pip install -r requirements-ml.txt`; keep the Railway image torch-free.

---

## Reviewing an agent's diff (you, before merging)
- [ ] No secrets or real phone numbers in the diff.
- [ ] `contracts.ts` / `schemas.py` unchanged (or changed in both, with team heads-up).
- [ ] No new dependency without a reason; no unrelated refactors.
- [ ] Nothing can send to a number that isn't `DEMO_PHONE_NUMBER`.
- [ ] Tests exist and pass; low-confidence/failure paths handled.
