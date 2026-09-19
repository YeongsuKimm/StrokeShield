# 07 — Team Workflow, Timeline & Demo

## Roles (4 people) — each owns the files in the linked spec
| Role | Owns | Spec |
|---|---|---|
| **A. Frontend + Agent lead** | Vite app, state machine, dashboard, ElevenLabs agent + client tools, demo panel | 04, 06 |
| **B. Vision** | MediaPipe face/pose metrics, overlay math, Claude second opinion | 02 |
| **C. Speech** | Recorder/WAV, DSP features, Scribe integration, calibration | 03 |
| **D. Backend + Alerts + Deploy** | FastAPI skeleton, schemas, Twilio, risk scoring, env, deployment, pitch/demo script | 01, 05 |

Everyone: keep `docs/spec/*` updated when reality diverges. Cross-role hand-offs happen only through contracts in `01-architecture.md`.

## Timeline (36–48 h)
| Hours | Goal | Exit criteria |
|---|---|---|
| 0–3 | **Foundation** | Repo scaffolded (Vite + FastAPI running), contracts in TS + Pydantic, `.env` shared via password manager, keys for Twilio/ElevenLabs/Anthropic working, Vercel + backend host created |
| 3–16 | **Parallel build against mocks** | A: state machine + UI with fake results. B: face/arm metrics passing fixture tests. C: record → WAV → `/speech/analyze` returns a score. D: `/alert` dry-run works, real Twilio call to demo number succeeds, risk fn tested. Agent responds and calls a stub tool |
| 16–24 | **Integration** | End-to-end happy path in dev: agent → tests → risk → countdown → real call/SMS. Deployed preview works over HTTPS |
| 24–32 | **Calibrate & harden** | Thresholds tuned on teammate fixtures, retries/fallbacks, demo mode, second opinion, geolocation link. Bug bash |
| 32–40 | **Polish & pitch** | UI polish, dashboard, sound/animation, pitch deck, README, full rehearsal ×3 |
| 40–T-6 h | **Feature freeze** | Bug fixes only. Tag `demo-v1`. Rehearse worst cases |
| T-6 h → | **Demo prep** | `DRY_RUN=false` on the demo deployment only, phones charged, backup video recorded, local fallback tested |

## Git rules
- Trunk-based: `main` always demo-able. Branch per task `role/short-name` (e.g. `vision/face-metrics`). Small PRs, at least a quick review from another human or a `code-review` pass.
- Contract change PR (touching `contracts.ts` / `schemas.py` / `01-architecture.md`) needs a heads-up in the team chat and a 👍 from the affected owners.
- Rebase/merge `main` often; resolve conflicts in your own files, ask before touching others'.
- Never commit `.env`, model weights > 50 MB (use `frontend/public/models/` for the small MediaPipe `.task` files only), or recorded personal video.

## Working with AI agents
- Start each agent session with: *"Read AGENTS.md and docs/spec/0X-….md, then do <task>. Only edit files in my module."*
- Give agents **fixtures + tests first** (metric functions, scoring) so they can iterate without a webcam.
- Ask agents to check current docs for ElevenLabs / MediaPipe / Twilio APIs; these change and model memory can be stale.
- Review AI diffs for: hardcoded secrets, changed contracts, new dependencies, unrequested refactors, and anything that could dial an arbitrary number.
- If the spec is wrong or missing something, fix the spec in the same PR so the next agent benefits.

## Definition of done (per module)
- Meets its spec's outputs (`TestResult` etc.), has pure-function tests, handles low-confidence/failure paths, thresholds in config, no secrets, works in demo mode.

## Demo script (~3 min)
1. **Problem** (20 s): stroke = time-critical, most people can't self-assess; FAST is the standard.
2. **Healthy run** (45 s): guided test, dashboard stays green, agent says checks look okay.
3. **Symptom run** (75 s): teammate mimics droop/arm drop/slurring (or demo panel "Simulate stroke"); agent announces, countdown, phone rings on stage, SMS with map link arrives.
4. **Voice request** (20 s): "Call 911" mid-test → immediate countdown.
5. **Tech + safety** (20 s): in-browser vision, DSP speech analysis, risk breakdown, demo-number guard, not a medical device.
Backup: pre-recorded video of the full flow; local run on laptop; demo panel to bypass live capture.

## Risks & mitigations
| Risk | Mitigation |
|---|---|
| Wifi/HTTPS/camera issues on demo day | Run locally on `localhost`; hotspot backup; recorded video |
| Detection false positive/negative live | Demo panel; calibrated thresholds; confidence gating |
| Agent talks over speech recording | Mic mute + agent waits for tool result; rehearse |
| Twilio trial limitations / SMS filtering | Upgrade + test early; toll-free sender |
| Scope creep | Stretch list in 00; freeze at hour 40 |
| Claims of medical accuracy | Explicit "demo, not a medical device" in UI and pitch |
