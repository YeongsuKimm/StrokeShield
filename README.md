# StrokeShield

Guided FAST stroke check (Face, Arms, Speech, Time) with an ElevenLabs voice assistant that calls for help when a risk score crosses a threshold.
HopHacks demo — **not a medical device**. In the demo, alerts only go to a team-owned number.

**Working with AI agents?** Read [AGENTS.md](AGENTS.md) and [docs/kickoff-prompts.md](docs/kickoff-prompts.md). Specs are in [docs/spec/](docs/spec/).

## Quickstart
```bash
git clone https://github.com/majesticcoder14/StrokeShield.git && cd StrokeShield
cp .env.example .env            # fill in keys (ask the team lead; never commit .env)

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
