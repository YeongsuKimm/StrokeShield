# Project Status (living doc)

**Every agent and human: read this first, and update it before you push.**
The `pre-push` hook and CI block code changes that don't touch this file. (Docs-only pushes are fine.)

## How to update (takes 1 minute)
1. Edit **your module's row** in the table below: status, what's next, blockers.
2. Add **one line** at the top of *Recent changes*: `YYYY-MM-DD — module — what changed and why it matters to others`.
3. If you changed behavior, thresholds, a protocol, or made a decision → update the matching `docs/spec/0X-*.md` too. Decisions also go in the Decisions log in `docs/spec/00-overview.md`.
4. Contracts (`frontend/src/lib/contracts.ts`, `backend/schemas.py`, `docs/spec/01-architecture.md`) always change **together**, and announce it in team chat.
**Owners are fluid** (`open` = unclaimed): put your name/handle in the Owner column when you start a row (several people can share one), clear it when you stop, and push the claim immediately. Pull before you claim.
Status values: `not started` · `in progress` · `blocked` · `done (untested live)` · `done`.

## Module board
| Module | Owner | Status | Notes / next / blockers |
|---|---|---|---|
| Foundation (repo, contracts, state machine, risk fn, API skeleton) | — | done | Vite+React+TS frontend, FastAPI backend, shared contracts, tests green |
| Alerts (Twilio call + SMS, demo-number guard, dry-run) | majesticcoder14 | done (untested live) | Only run against a fake Twilio client. Next: verify number in Twilio, real call+SMS with `DRY_RUN=false`; Dockerfile + Railway |
| Frontend / camera view / captions | open | in progress | Done (untested live): `CameraView` (mirrored video, overlay, framing outline, hint pill, captions, 3-2-1), `?debug=1` panel, dashboard, countdown, demo panel. Open: **stand-here guide/silhouette for the arms test**, stepper UI, polish, remove the TEMP manual test buttons in `App.tsx` when the agent drives the flow |
| Voice agent (ElevenLabs) | open | not started | Client tool stubs exist. Next: create the agent in the dashboard, `useAgent.ts`, signed URL endpoint |
| Vision: framing gates | majesticcoder14 | done (untested live) | `checkFaceFraming` / `checkArmFraming` + tests, wired to live landmarks in the runtime, plus a yaw hint ("Look straight at the screen") |
| Vision: face + arm metrics | majesticcoder14 | done (untested live) | `analyzeFace` / `analyzeArms` implemented + synthetic-fixture tests; thresholds UNCALIBRATED, left/right mapping ASSUMED. **Do not reimplement.** Open: verify left/right on a real camera (`?debug=1`), then calibrate on teammate recordings (spec 02) |
| Vision: MediaPipe runtime (`useMediaPipe`, capture controller, test runner) | majesticcoder14 | done (untested live) | Webcam → landmarks → capture timing → `testRunner.runFace()` / `runArms()` (always resolve with a `TestResult`; retries carry a spoken-style `flags[0]`). Models committed in `frontend/public/models/`; wasm copied from node_modules on `pnpm install`. **Agent dev: wire `start_face_test` / `start_arm_test` in `lib/agent/clientTools.ts` to `testRunner`.** Open: run the `?debug=1` live checks (GETTING-STARTED §8) |
| Speech (recorder + DSP + Scribe) | open | not started | `models/audio.py` stub, thresholds in `models/config.py` (uncalibrated) |
| Stretch: eyes test (BE-FAST) | majesticcoder14 | done (untested live), not wired | `analyzeEyes`, `eyeProtocol.ts` and `EyeStimulus` component + tests exist; `FEATURES.eyesTest` stays `false`. Extension points are marked in `capture.ts` / `useTestRunner.ts`. Open: wire `runEyes()` + stimulus, agent tool `start_eye_test`, live verify, calibrate |
| Stretch: phoneme scoring (wav2vec2) | open | spec only | Flag `PHONEME_SCORING=false`; needs `requirements-ml.txt`; verify model id/license |
| Stretch: Claude vision second opinion | open | stub | `models/vision.py` returns `unclear` |
| Deploy (Vercel + Railway) | backend | not started | Backend runs on demo laptop; Railway is backup (torch-free) |

## Open decisions / blockers
- Verify demo phone number in Twilio; confirm the trial number can text it.
- ElevenLabs agent + Anthropic key not created yet.
- Backup demo teammate for the patient role: TBD.
- **Decision needed:** speech max risk weight is 0.5, so a clear speech-only deficit (0.45) does NOT alert while a clear face/arm deficit does. Raise `MAX_WEIGHTS.speech` to 0.6 for "any one FAST sign alerts"? Revisit once speech is calibrated (spec 05, `consistency.test.ts`).
- Live-camera verification of left/right mapping (face landmarks, blendshapes, arms 11/13/15, eye landmarks) is pending on real hardware: see spec 02 "Shared conventions".
- Test order is Face → (Eyes) → Speech → Arms (patient steps back once). Change `testSequence()` in `frontend/src/lib/config.ts` if the team disagrees.

## Known issues
- All thresholds/weights are uncalibrated (see spec files). Calibrate on teammate fixtures around hour ~20.

## Recent changes (newest first)
- 2026-09-18 — vision/frontend — merged the live-camera runtime: `useMediaPipe` (shared engine, GPU→CPU fallback, offline wasm + models), pure `capture.ts` state machine (framing gate → neutral/smile or 3-2-1/10 s hold), `useTestRunner` (`runFace`/`runArms`), `CameraView`, `?debug=1` panel, TEMP manual test buttons in `App.tsx`. **Run `pnpm install` again** (postinstall copies the MediaPipe wasm, ~35 MB, gitignored). 157 frontend tests. Nothing verified on a real camera yet.
- 2026-09-18 — vision — merged face, arms and eyes analysis (`analyzeFace/Arms/Eyes`, `EyeStimulus`, ~113 frontend tests). Shared conventions enforced by `vision/consistency.test.ts` (severity anchors healthy ≤ 0.15 / borderline ≈ 0.35 / clear ≥ 0.85, one retry cutoff `MIN_CONFIDENCE`, patient-side left/right, epoch `startedAt` via `vision/time.ts`, 16:9 default aspect). Spec 02 updated with as-built weights/ramps (arms + eyes weights differ from the original spec to hit the anchors) and naming (`_left/_right`).
- 2026-09-18 — team — added `docs/GETTING-STARTED.md` (step-by-step teammate onboarding); owners are fluid (claim rows in this table).
- 2026-09-18 — tooling — added `docs/STATUS.md`, `scripts/check-docs.sh`, `.githooks/pre-push`, CI workflow. Run `bash scripts/setup-hooks.sh` once per clone.
- 2026-09-18 — vision/frontend — patient positioning: test order is now Face → (Eyes) → Speech → Arms; `framing.ts` gates tell the patient to move closer / step back; store has `hint`; progression = first test without a usable result.
- 2026-09-18 — contracts/config — added `eyes` test type, `FEATURES.eyesTest` (off), `PHONEME_SCORING` (off), specs for both stretches.
- 2026-09-18 — foundation — initial scaffold, alert path with demo-number guard, kickoff prompts.
