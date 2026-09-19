# Getting Started (teammates: do this, in order)

Repo: https://github.com/majesticcoder14/StrokeShield · Full picture: [README.md](../README.md) · Live status: [STATUS.md](STATUS.md)

## 0. You need
- Git, **Python 3.11 or 3.12** (not 3.13: mediapipe doesn't support it yet), **Node 20+**, **pnpm** (`npm i -g pnpm`), Chrome, and your AI coding agent (Claude Code, Codex, Gemini CLI, …).
- A GitHub account with push access (ask the lead, `majesticcoder14`, to add you).

## 1. Clone and set up (10 min)
```bash
git clone https://github.com/majesticcoder14/StrokeShield.git && cd StrokeShield
bash scripts/setup-hooks.sh          # REQUIRED, once: enables the docs check on git push
cp .env.example .env                 # then fill in keys (step 2)
```
**Backend** (venv shown; conda with `python=3.11` works too):
```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
pytest                                                  # expect all green
uvicorn backend.main:app --reload --port 8000           # http://localhost:8000/api/health
```
**Frontend** (second terminal):
```bash
cd frontend && pnpm install && pnpm dev                 # http://localhost:5173  (install also copies the MediaPipe wasm; models are committed)
pnpm test && pnpm typecheck && pnpm lint                # expect all green
```
Open **http://localhost:5173/?demo=1**, click **Simulate stroke**: you'll see the whole flow with fake results and a countdown. If that works, your setup is good.

## 2. Keys and safety (read this)
- **Never commit `.env`** (it's gitignored) and never paste keys in chat groups, issues or PRs. The lead shares real values privately (password manager or DM).
- Leave **`DRY_RUN=true`**. In dry-run the alert endpoint only logs. Only the lead arms real SMS sending (`DRY_RUN=false`) for the live demo.
- The backend can only ever text the number in `DEMO_PHONE_NUMBER`. Do not add code that takes a phone number from a request or hardcodes 911. Do not put real phone numbers in code, docs or tests (tests use `+15555550100`).
- You only need the keys for the feature you're building (Twilio → alerts, ElevenLabs → agent/speech, Gemini (free key from aistudio.google.com/apikey) → vision second opinion).

## 3. Pick and claim a task
Ownership is **fluid**: anyone can take anything.
1. `git pull`, open [STATUS.md](STATUS.md), pick a row that is `not started` or `in progress` and unblocked (ask in chat if unsure).
2. Put your name/handle in the **Owner** column and set status `in progress`. If someone is already on it, coordinate in chat and share the row (`alice, bob`).
3. Push that one-line claim right away so others see it (docs-only pushes pass the hook): `git commit -am "status: claim <task>" && git push`.
4. If you stop working on something, clear your name and add a note on where you left off.

## 4. Do the work with your AI agent
1. Branch: `git checkout -b <area>/<short-name>` (e.g. `vision/face-metrics`, `speech/recorder`, `agent/client-tools`).
2. Start your agent with the prompt for your task from [kickoff-prompts.md](kickoff-prompts.md). The agent auto-reads [AGENTS.md](../AGENTS.md); the prompt points it at the right spec in [docs/spec/](spec/) and at STATUS.md.
3. Make the agent **plan first**, then write **tests first** (metric/scoring code is pure functions, no webcam needed).
4. Keep changes inside the files your task names. If you need something in someone else's area, make a small change and tell them, or ask them.
5. **Shared types are special:** `frontend/src/lib/contracts.ts`, `backend/schemas.py` and `docs/spec/01-architecture.md` must change **together**, and you announce it in chat first.

## 5. Before every push
- [ ] `pytest` and `cd frontend && pnpm test && pnpm typecheck && pnpm lint` pass.
- [ ] **`docs/STATUS.md` updated**: your row + one line at the top of *Recent changes*. (The push is blocked without it.)
- [ ] The matching `docs/spec/0X-*.md` updated if you changed behavior, thresholds, a protocol, or made a decision.
- [ ] Diff reviewed for: secrets, real phone numbers, changed contracts, new dependencies, unrequested refactors, anything that could dial another number.
```bash
git push -u origin <your-branch>       # then open a PR into main
```
Ask your agent: "Update docs/STATUS.md and any spec my change made stale, then tell me what you updated." It's usually 30 seconds.

## 6. Merging
- Small PRs into `main`. CI must be green (tests, lint, build, docs check).
- Skim your own diff with the checklist above, merge it yourself. Get a teammate's eyes for anything touching **alerts/Twilio, contracts, or `.env.example`**.
- `main` must always run: if you break it, fix it first. Pull/rebase from `main` often.
- Hotfix escape hatch (rare): put `[skip-docs]` in the commit message to bypass the docs check.

## 7. When things go wrong
| Problem | Fix |
|---|---|
| `pip install` fails on mediapipe | You're on Python 3.13. Use 3.11 or 3.12. |
| Push blocked: "docs/STATUS.md was not updated" | Update it (step 5). It's intentional. |
| Push blocked about contracts | Change `contracts.ts`, `schemas.py` and `01-architecture.md` together. |
| Frontend can't reach backend | Backend must run on :8000; use `pnpm dev` (it proxies `/api`). |
| Camera/mic blocked | Use `http://localhost` or HTTPS; check browser permissions. |
| Twilio "unverified number" | Trial accounts only reach verified numbers; ask the lead. |
| Lost / unsure | Read [STATUS.md](STATUS.md), then the spec for your area, then ask in chat. |

## 8. Live camera check (once per person/laptop, 5 min): helps everyone
The vision tests assume which side of the face/body is the patient's left/right; that has NOT been confirmed on real hardware yet. Open **http://localhost:5173/?debug=1** (needs `pnpm install` once so the MediaPipe files are in place), allow the camera, then:
1. Raise only your **right** hand: the orange `12/14/16` labels must follow it. If not, flip `ARMS_CONFIG.swapLeftRight` in `frontend/src/lib/vision/arms.ts`.
2. Raise only your **left** hand: the cyan `11/13/15` labels must follow it.
3. Smile on your **right** side only: orange `61` must be on that side and `mouthSmileRight` must rise. If the blendshapes are swapped, flip `FACE_CONFIG.blendshapeLeftIsPatientLeft` in `face.ts`.
4. Use the **Run face test** / **Run arm test** buttons and check the results and captions make sense (step back for arms; ~2 m).
Report what you found in chat and record any flag you flipped in `docs/STATUS.md`.

## 9. Help calibrate (a few minutes each, whole team)
The tests' thresholds are guesses until tuned on real people. Record ~20 short runs following [CALIBRATION.md](CALIBRATION.md) (`?record=1`), drop the files in `frontend/recordings/`, and run `pnpm calibrate` to see how the scoring does.

## Validation (whoever tunes; everyone recording)
Use ONE consistent id per person when recording (it decides the tune/validate split) and fill in the conditions. The proof protocol is [VALIDATION.md](VALIDATION.md).

## SMS alerts
Setup and troubleshooting: [SMS-SETUP.md](SMS-SETUP.md); check your setup any time with `python scripts/sms_check.py` (read-only).

## 10. Optional: phoneme scoring (PyTorch), laptop only
Not needed for normal work. If you want to test/tune the advanced speech scoring: `pip install -r requirements-ml.txt` (~1 GB, CPU PyTorch), `python -m models.phoneme --download` (378 MB, once), set `PHONEME_SCORING=true` in `.env`. Without it everything still works (acoustic-only speech scoring).

## Map of the docs
[STATUS.md](STATUS.md) live board · [CALIBRATION.md](CALIBRATION.md) recording + tuning · [VALIDATION.md](VALIDATION.md) proof protocol · [spec/00-overview.md](spec/00-overview.md) scope and decisions · [spec/01-architecture.md](spec/01-architecture.md) contracts and APIs · [spec/02-vision.md](spec/02-vision.md) · [spec/03-speech.md](spec/03-speech.md) · [spec/04-voice-agent.md](spec/04-voice-agent.md) · [spec/05-risk-and-alerts.md](spec/05-risk-and-alerts.md) · [spec/06-frontend-ux.md](spec/06-frontend-ux.md) · [spec/07-workflow.md](spec/07-workflow.md) timeline, demo script
