# Calibration: how we check the tests are accurate

All thresholds are guesses until tuned on real people. This is the loop: **record → replay → tune → repeat**. It needs no coding to record; tuning is small edits to the config blocks.

## What "accurate" means here (targets)
| Kind of run | Target |
|---|---|
| Healthy, including naturally lopsided smiles / slightly uneven arms | severity **≤ 0.15**, **never** alerts |
| Borderline | ~0.3–0.4, never alerts alone |
| Mimicked clear deficit | severity **≥ 0.85**, **correct side** |
| Retries (test refused to score) | under ~20% of runs |
Headline numbers `pnpm calibrate` prints: false alarms on healthy runs (want **0**), clear deficits detected, retry rate. See spec 02 "Shared conventions" for why these bands.
**Honest limit:** a teammate mimicking a droop is not a stroke patient. This measures "does it catch deliberate asymmetry without crying wolf on healthy people", not clinical accuracy. Say that in the pitch.

## Before recording: check left/right first (5 min, once)
If the app mixes up left and right, every "side" result is wrong. Do the live camera check in [GETTING-STARTED.md](GETTING-STARTED.md) §8 (`?debug=1`) first, flip the flag it tells you to if needed, and note it in STATUS.md.

## Recording (about 10 minutes per person)
1. `pnpm dev`, open **http://localhost:5173/?record=1** in Chrome. A red "Recording mode" panel appears (top right).
2. Type your name or an anonymous id (e.g. `sam`). It's remembered.
3. Pick a **scenario**, read the instruction under it, and press **Run face test** or **Run arm test** (the normal buttons). Each completed run is saved and downloads a `.json` file. If the browser blocks many downloads, uncheck auto-download and use the **save** buttons.
4. **"left" and "right" always mean YOUR OWN left/right.** "Droop on your left" = your left cheek/arm.
5. Vary the conditions on purpose, and write them in Notes: with/without glasses, brighter/dimmer light, closer/further, different times of day.
6. Do each scenario at least **twice**:
   - Face: normal smile · naturally lopsided smile (don't exaggerate) · mimic droop on left · mimic droop on right
   - Arms: hold steady · both sink a little equally · left arm drifts down · right arm drifts down · left arm won't lift · right arm won't lift
   That's ~20 runs per person. Aim for **at least 8 different people** (different faces, glasses, facial hair, skin tones). Healthy runs from diverse people matter most, because a false alarm on stage is the worst outcome.
7. Move the downloaded files into **`frontend/recordings/`** (gitignored). They are landmark numbers (no video or images), but they are still data about real people: don't commit or post them. Share via the team drive. To commit a *consented* recording as a permanent regression fixture, put it in `frontend/src/lib/calibration/fixtures/recordings/` and say so in the PR.

## Replaying and reading the report
```bash
cd frontend && pnpm calibrate
```
It replays every recording (committed fixtures + `frontend/recordings/`) through the same analyzers the app uses and prints one row per scenario (runs, passes, retries, severity mean/min-max, alerts, side correctness), then the headline numbers, then **every run that missed** its expectation, e.g.:
```
FAIL  sam__face-mimic-left-droop__….json [face-mimic-left-droop] wrong side: got right, expected left
FAIL  alex__face-healthy__….json [face-healthy] FALSE ALARM: would trigger the alert
```
It also shows which runs scored differently now than when recorded (after you change thresholds). The command fails (red) while any run misses; green means everything meets the targets.

## Tuning
1. Look at the worst rows first: false alarms and misses, then wrong sides, then high retry rates.
2. Wrong side on everything → left/right mapping, not thresholds (`ARMS_CONFIG.swapLeftRight`, `FACE_CONFIG.blendshapeLeftIsPatientLeft`).
3. Otherwise adjust the ramps/weights in `FACE_CONFIG` (`face.ts`), `ARMS_CONFIG` (`arms.ts`), `EYES_CONFIG` (`eyes.ts`). Re-run `pnpm calibrate` (seconds, no camera needed). Keep `pnpm test` green: `vision/consistency.test.ts` guards the shared conventions.
4. High retry rate → the capture gates are too strict for real cameras (min frames, yaw, face width, brightness); loosen them, or fix how the runner feeds frames.
5. When the team agrees on new values: update the config, spec 02 (as-built values) and `docs/STATUS.md`, and say what data the values are based on (e.g. "12 people, 248 runs").

## Not covered yet
- **Eyes:** recording schema and replay support `eyes`, but `runEyes` isn't wired, so there are no eyes scenarios yet. Add them to `SCENARIOS` in `lib/calibration/recording.ts` when it is.
- **Speech:** audio clips need the recorder (spec 03) and a Python replay (`python -m models.calibrate`, spec 03). Use the same idea: normal vs simulated-slurred clips in `tests/fixtures/audio/`.
- **End to end:** calibration checks the scoring only. Still do full rehearsals of the demo (spec 07).
