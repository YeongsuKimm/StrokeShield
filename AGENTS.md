# StrokeShield — Agent Instructions

Canonical instructions for every AI coding agent (Claude Code, Codex, Gemini CLI, etc.) working in this repo.
`CLAUDE.md` and `GEMINI.md` just point here. **Read this file, then the spec file for your module in `docs/spec/`.**

## What we're building
A web app for HopHacks that runs a guided **FAST stroke check** (Face, Arms, Speech, Time) on a webcam + mic,
narrated by an **ElevenLabs voice agent**. Each test produces a severity score; a weighted **risk score** decides
whether to place an **emergency call + SMS via Twilio**. In the demo, the call/SMS goes ONLY to `DEMO_PHONE_NUMBER`.
It is a hackathon demo, **not a medical device**.

## Stack
- Frontend: `frontend/` — Vite + React + TypeScript, Tailwind, Zustand. MediaPipe Tasks Vision (`@mediapipe/tasks-vision`) runs in the browser.
- Backend: `backend/main.py` — FastAPI (Python **3.11 or 3.12**; mediapipe doesn't support 3.13 yet). Routers in `backend/routers/`, Pydantic schemas in `backend/schemas.py`.
- `models/` — analysis logic (pure Python, no HTTP): `audio.py` speech DSP + scoring, `vision.py` second-opinion vision call.
- `services/` — thin wrappers around external APIs: `elevenlabs_service.py`, `twilio_service.py`.
- Hosting: frontend on Vercel (HTTPS needed for camera/mic; `localhost` also works), backend on Railway (Dockerfile) or local.

## Commands
```bash
# backend (from repo root)
python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
pytest                      # backend + models tests

# frontend
cd frontend && pnpm install && pnpm dev     # http://localhost:5173
pnpm test                   # vitest (pure-function metric tests)
pnpm typecheck && pnpm lint
```

## Spec map (read only what you need)
| File | Owns |
|---|---|
| `docs/spec/00-overview.md` | Product scope, decisions log, open questions |
| `docs/spec/01-architecture.md` | Repo layout, **contracts (shared types)**, API endpoints, env vars |
| `docs/spec/02-vision.md` | Face + arm detection, second-opinion vision |
| `docs/spec/03-speech.md` | Speech recording, DSP features, scoring |
| `docs/spec/04-voice-agent.md` | ElevenLabs agent, client tools, prompt, flow |
| `docs/spec/05-risk-and-alerts.md` | Risk score, thresholds, Twilio alert, safety guards |
| `docs/spec/06-frontend-ux.md` | Session state machine, screens, dashboard, demo mode |
| `docs/spec/07-workflow.md` | Team split, timeline, git rules, demo script |

## Hard rules
1. **Safety guard:** the backend may only ever dial/text `DEMO_PHONE_NUMBER` from env. Never accept a destination number from a request body. Never hardcode 911. Respect `DRY_RUN`.
2. **Secrets** live in `.env` (gitignored). Never commit keys, never put secret keys in `frontend/` code (only `VITE_*` public values).
3. **Contracts are shared.** Types in `docs/spec/01-architecture.md` are mirrored in `frontend/src/lib/contracts.ts` and `backend/schemas.py`. Change both in the same PR and tell the team. Don't invent new fields silently.
4. **Scoring/metric code must be pure functions** (input arrays → numbers). No DOM, no network, no globals. This makes them unit-testable with fixtures and lets you work without a webcam.
5. **Every test module returns a `TestResult`** (severity 0–1, confidence 0–1, metrics, flags). Low confidence must degrade gracefully ("retry"), never crash or produce a confident guess.
6. **The agent never diagnoses.** Verdicts come from the app's risk score; the voice agent only guides and relays.
7. **Stay in your lane.** Edit files in your module. Cross-module changes → small PR + ping the owner.
8. **Keep the demo path working.** If you break `main`, fix it first. Demo mode (`docs/spec/06-frontend-ux.md`) must always work.
9. Don't add dependencies without a reason; note new ones in the PR. Don't refactor unrelated code.

## Conventions
- TypeScript strict; no `any` without a comment. Python: type hints, `ruff`-clean, Pydantic v2.
- Camera video is displayed **mirrored** but landmark math uses **raw (unmirrored) coordinates**. Document any left/right mapping you verify.
- Thresholds live in one config per module (`frontend/src/lib/config.ts`, `models/config.py`) with a comment marking them *uncalibrated* until tuned on fixtures.
- Log with `console.debug` / `logging` and tag with the module name; no PII in logs.
- Commits: small, imperative subject, prefix with module (`vision:`, `speech:`, `agent:`, `alert:`, `ui:`).
