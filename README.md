# StrokeShield

A tool to help guide someone through the BE-FAST stroke check (Eyes, Face, Arms, Speech, Time) with an ElevenLabs voice assistant. If the checks flag something, it can text a demo phone number.
HopHacks demo. **StrokeShield is only a guide: it is not clinically accurate, not a medical device, has not been validated, and cannot diagnose or rule out a stroke. If you think someone may be having a stroke, call 911 right away.** In the demo, alerts only go to a team-owned number. The wording lives in `frontend/src/lib/disclaimer.ts`.

**New teammate? Start with [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md).**

**Where things stand:** [docs/STATUS.md](docs/STATUS.md) (kept current on every push).

**Working with AI agents?** Read [AGENTS.md](AGENTS.md) and [docs/kickoff-prompts.md](docs/kickoff-prompts.md). Specs are in [docs/spec/](docs/spec/).

## Quickstart
```bash
git clone https://github.com/majesticcoder14/StrokeShield.git && cd StrokeShield
cp .env.example .env            # fill in keys (ask the team lead; never commit .env)
bash scripts/setup-hooks.sh     # once: pushes that change code must also update docs/STATUS.md

# backend (Python 3.11 or 3.12)
python -m venv .venv && source .venv/bin/activate      # or: conda create -n StrokeShield python=3.11
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
pytest

# frontend (Node 20+, pnpm)
cd frontend && pnpm install && pnpm dev                 # http://localhost:5173
pnpm test && pnpm typecheck && pnpm lint
```
Open `http://localhost:5173/?demo=1` for the demo panel (simulate healthy / stroke results without a webcam).
`DRY_RUN=true` (default) means the alert endpoint logs instead of calling/texting.

## Layout
`frontend/` React + TS + MediaPipe · `backend/` FastAPI · `models/` speech + vision analysis · `services/` Twilio / ElevenLabs · `tests/` pytest · `docs/spec/` specs
