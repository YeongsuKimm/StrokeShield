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
| Frontend / camera view / captions | open | in progress | Dashboard, countdown, demo panel, hint caption exist. Next: camera view + overlay, stand-here guide |
| Voice agent (ElevenLabs) | open | not started | Client tool stubs exist. Next: create the agent in the dashboard, `useAgent.ts`, signed URL endpoint |
| Vision: framing gates | open | done | `checkFaceFraming` / `checkArmFraming` + tests. Next: wire to live landmarks |
| Vision: face + arm metrics | open | not started | `analyzeFace` / `analyzeArms` are stubs returning `needsRetry`. Next: implement per spec 02 |
| Vision: MediaPipe runtime (`useMediaPipe`) | open | not started | Model files go in `frontend/public/models/` |
| Speech (recorder + DSP + Scribe) | open | not started | `models/audio.py` stub, thresholds in `models/config.py` (uncalibrated) |
| Stretch: eyes test (BE-FAST) | open | spec only | `eyes` type + `FEATURES.eyesTest=false` + weight exist; nothing else built |
| Stretch: phoneme scoring (wav2vec2) | open | spec only | Flag `PHONEME_SCORING=false`; needs `requirements-ml.txt`; verify model id/license |
| Stretch: Claude vision second opinion | open | stub | `models/vision.py` returns `unclear` |
| Deploy (Vercel + Railway) | backend | not started | Backend runs on demo laptop; Railway is backup (torch-free) |

## Open decisions / blockers
- Verify demo phone number in Twilio; confirm the trial number can text it.
- ElevenLabs agent + Anthropic key not created yet.
- Backup demo teammate for the patient role: TBD.
- Test order is Face → (Eyes) → Speech → Arms (patient steps back once). Change `testSequence()` in `frontend/src/lib/config.ts` if the team disagrees.

## Known issues
- All thresholds/weights are uncalibrated (see spec files). Calibrate on teammate fixtures around hour ~20.

## Recent changes (newest first)
- 2026-09-18 — team — added `docs/GETTING-STARTED.md` (step-by-step teammate onboarding); owners are fluid (claim rows in this table).
- 2026-09-18 — tooling — added `docs/STATUS.md`, `scripts/check-docs.sh`, `.githooks/pre-push`, CI workflow. Run `bash scripts/setup-hooks.sh` once per clone.
- 2026-09-18 — vision/frontend — patient positioning: test order is now Face → (Eyes) → Speech → Arms; `framing.ts` gates tell the patient to move closer / step back; store has `hint`; progression = first test without a usable result.
- 2026-09-18 — contracts/config — added `eyes` test type, `FEATURES.eyesTest` (off), `PHONEME_SCORING` (off), specs for both stretches.
- 2026-09-18 — foundation — initial scaffold, alert path with demo-number guard, kickoff prompts.
