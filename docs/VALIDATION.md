# Validation: how we prove it works

Goal: numbers we can defend to a judge. **Tune on some people, freeze the thresholds, validate once on other people, report honest confidence bounds.**
Tools: `pnpm tune|freeze|validate` (vision, in `frontend/`) and `python -m models.validate` (speech, repo root). Recording: [CALIBRATION.md](CALIBRATION.md).

## What this can and can't prove
- **Can:** it works on real hardware; it separates healthy people from *mimicked* deficits on people the thresholds never saw; healthy runs don't false-alarm (with a stated upper bound); failures degrade gracefully.
- **Can't:** clinical accuracy. Volunteers faking a droop are not stroke patients. Say "screening heuristic validated on N volunteers", never "detects strokes".
- **Also not covered by recordings:** the alert path, the voice agent, timing, failure handling. See "System checks" below.

## The rules that make it evidence
1. **One id per person, always the same** (lowercase name or nickname). The split is decided by a hash of that id (`sha1(id.strip().lower()) % 100 < 60` → tune, else validate; identical in the TypeScript and Python tools). Recording one person under two ids leaks them into both groups.
2. **Never tune on validation people.** `pnpm tune` and `python -m models.validate --mode tune` show only the tune group. Look at validation results only after freezing.
3. **Freeze before validating.** The freeze stores a fingerprint of every threshold; the validation report says `Thresholds frozen: YES (hash matches …)` or that it is **NOT independent evidence**.
4. **Validate once per freeze.** If you look, change a threshold, and validate again, the validation people have become tuning people. Re-freeze and record new people.
5. Runs from one person aren't independent, so intervals are optimistic; more *people* beats more runs per person.

## Step by step
**0. Hardware (about 1 h, once).** GETTING-STARTED §8 (camera: left/right, fps ≥ 15, arms framing at ~2 m in the demo room) and the speech recorder checklist (mic prompt, valid 16 kHz WAV, auto-stop, whisper/shout hints). Do this first: a swapped left/right invalidates every "side" result. Note any flag you flipped in STATUS.md.

**1. Record.** `?record=1` (vision) and the speech panel: fill in **conditions** (glasses, facial hair, lighting, distance, device; mic, noise, native English) so reports can break results down. Cover variety on purpose: glasses/no glasses, bright/dim, close/far, laptop mic/headset, quiet/noisy, accents. Vision files → `frontend/recordings/`, speech → `recordings/speech/` (gitignored; personal data: never commit).
Per person, aim for: eyes 2 healthy + 4 mimic; face 4 healthy + 4 mimic; arms 4 healthy + 4 mimic; speech 6 healthy + 4 mimic. **To make the acceptance criteria meaningful you need ≥ 60 healthy runs per test in the validation group**, so plan ≥ 8 validation people × ≥ 8 healthy runs per test (different days/conditions). If the team is smaller, run what you can: the report says INSUFFICIENT DATA and gives the bound you *can* claim (e.g. "0 false alarms in 20 runs: < 11.9 %"). Check who landed where with `pnpm tune` / `pnpm validate` **before** looking at results; a `split.json` next to the recordings (`{"tune":[…],"validate":[…]}`) overrides the hash, decided up front.

**2. Tune (tune group only).**
```bash
cd frontend && pnpm tune                          # face/arms(/eyes): tables, suggested ramps, threshold sweep
python -m models.validate --mode tune             # speech (set PHONEME_SCORING=true to include the PyTorch scores)
```
Read the worst rows first. Suggestions are never applied automatically: you edit `FACE_CONFIG` / `ARMS_CONFIG` / `EYES_CONFIG` (`frontend/src/lib/vision/`) and `models/config.py`. Targets: healthy ≤ 0.15, borderline 0.2–0.55, clear deficit ≥ 0.85, correct side, retries < 20 %. `pnpm test` and `pytest` must stay green (they guard the shared conventions). Wrong side on *everything* means left/right mapping, not thresholds.

**3. Freeze.**
```bash
cd frontend && pnpm freeze                        # writes docs/validation/frozen-vision.json
python -m models.validate --freeze                # writes docs/validation/frozen-speech.json (records whether PyTorch scoring was on)
git add docs/validation/frozen-*.json && git commit -m "validation: freeze thresholds"
```
Freeze with exactly the settings you will demo (same `PHONEME_SCORING`).

**4. Validate once (validation group).**
```bash
cd frontend && VALIDATE_OUT=../docs/validation/vision-$(date +%F).md pnpm validate
python -m models.validate --mode validate --out docs/validation/speech-$(date +%F).md
```
Each criterion prints PASS / FAIL / INSUFFICIENT DATA: false alarms on healthy runs (upper 95 % bound < 5 %, n ≥ 60), healthy ≤ 0.15 (≥ 95 %), mimicked deficits ≥ 0.85 (≥ 90 %), correct side (100 %), retry rate (≤ 20 %), borderline never alerts. It exits non-zero on FAIL. The `--out` reports are PUBLIC (no names or file names): commit them. If something FAILs, that is a finding: fix, re-freeze, and validate on **new** people.
Speech note: speech alone can never alert (max weight 0.5), so its false-alarm criterion passes trivially; the meaningful speech check is "healthy ≤ 0.15", broken down by noise, mic and accent.

## System checks (not recordings)
- [ ] Real Twilio call + SMS to the verified demo number with `DRY_RUN=false` (never yet run against real Twilio); note time from trigger to ring.
- [ ] Failure drills each show a clear message, not a blank screen: backend down, mic unplugged/denied, camera blocked/denied, wifi off.
- [ ] Demo-room run: distance for arms framing, lighting, noise, the actual laptop; ≥ 3 full timed rehearsals; demo panel fallback works.
- [ ] Memory/CPU on the demo laptop with the browser, backend and PyTorch model all running (model needs ~1.4 GB; benchmark: 8 threads ≈ 0.45 s per clip).

## What to commit
Yes: thresholds/config changes, `docs/validation/frozen-*.json`, PUBLIC reports, consented fixtures (`frontend/src/lib/calibration/fixtures/recordings/`, `tests/fixtures/audio/`). **No:** recordings of people, model weights, PyTorch (`requirements-ml.txt` documents the install; the 378 MB model is cached on the demo laptop via `python -m models.phoneme --download`).

## How to word it
"Thresholds were tuned on N volunteers (M runs) and frozen; validated once on K different volunteers (R runs) under [conditions]: 0 false alarms in R_healthy healthy runs (upper 95 % bound X %), Y % of mimicked deficits detected with the correct side. Mimicked deficits are not stroke patients; this is a screening heuristic, not a medical device."
