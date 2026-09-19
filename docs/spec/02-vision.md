# 02 — Vision: Face & Arms (+ second opinion)

Owner: Vision dev. Files: `frontend/src/lib/vision/*`, `models/vision.py`, `backend/routers/vision.py`.
Output: two `TestResult`s (`face`, `arms`) and optional `VisionOpinion[]`.

## Runtime
- `@mediapipe/tasks-vision`: `FaceLandmarker` (`outputFaceBlendshapes: true`, `outputFacialTransformationMatrixes: true`) and `PoseLandmarker` (lite/full), `runningMode: "VIDEO"`, GPU delegate with CPU fallback. Load model files from `frontend/public/models/` (don't fetch from a CDN on demo day).
- Run detection with `requestAnimationFrame` on the `<video>`; throttle to ~15–30 fps. Keep detection out of React render; push summaries into the store at ≤5 Hz.
- Metric functions take plain arrays (`{x,y,z,visibility}[]`) so they can be unit-tested with JSON fixtures.
- Verify landmark index ↔ anatomy with the debug overlay early, and record the verified left/right mapping in a code comment. (Reference indices below are the standard MediaPipe Face Mesh / BlazePose ones.)

## Positioning: close for the face, back for the arms
The face needs to fill enough of the frame for reliable landmarks; the arms test needs the whole upper body **and both hands** in frame. One camera can't do both, so the session is ordered **Face → (Eyes) → Speech → Arms** (`testSequence()` in `config.ts`): the patient starts close to the screen (~50–70 cm / arm's length; better landmarks, and the mic is close for speech), then steps back **once** (~2 m / 6 ft) for the arms.

Before each test, run a **framing gate** (`frontend/src/lib/vision/framing.ts`, pure, already implemented + tested):
- `checkFaceFraming(faceLandmarks)` — face width within 18–60 % of the frame and not touching an edge. Hints: "Move a little closer to the screen." / "Move back a little." / "Center your face in the view."
- `checkArmFraming(poseLandmarks)` — both shoulders, elbows **and wrists** visible (≥ 0.5) and inside the frame; shoulder width ≥ 9 % of frame width (not too far). Hints: "Step back until I can see both hands and both shoulders." / "Move a little closer."
- Thresholds are in `FRAMING_LIMITS` (uncalibrated; tune in the actual demo room).
- The test starts only after framing has been OK for `holdOkMs` (1.5 s) continuously. If it never gets OK within `waitTimeoutMs` (25 s), the tool returns a retry result ("couldn't see both hands") rather than scoring garbage.
- The current hint goes into the store (`setHint`) as an on-screen caption, and the agent tool result / `sendContextualUpdate` lets the assistant say it aloud.
- Once framing is OK for the arms test: caption "Get ready… 3, 2, 1, raise your arms," then the 10 s measurement.

Demo-room checklist: ~2.5 m of clear floor behind the patient's start position, camera at about chest/face height, tape a mark on the floor for the "far" spot, good front lighting. Test the room before the demo; wide-angle webcams help.

## Face test ("Show me a big smile")
Protocol (~8 s): (1) "Relax your face" — 1.5 s **neutral** capture. (2) "Now smile as big as you can and hold" — 3 s **smile** capture. Retry once if smile not detected.

Landmarks (Face Mesh): mouth corners `61`, `291`; nose tip `1`; eye outer corners `33`, `263`; inner corners `133`, `362`; chin `152`; lids `159/145` and `386/374`; brows `105`, `334`.

Steps:
1. **Roll-correct**: rotate all points so the line between outer eye corners is horizontal. Normalize by inter-ocular distance (IOD).
2. Per side, **corner lift** = (neutral corner position − smile corner position) along the face's vertical axis, normalized by IOD. Droop = one side lifts less.
3. Blendshapes: `mouthSmileLeft/Right`, `mouthFrownLeft/Right`, `eyeBlinkLeft/Right`, `browDownLeft/Right`.
4. Use the **median of the top 20 % smile frames** (by mean smile blendshape) to resist jitter.

Metrics (put all in `metrics`):
| Metric | Definition |
|---|---|
| `lift_asym` | `|liftL − liftR| / max(liftL, liftR, ε)` — primary |
| `smile_bs_asym` | `|smileL − smileR| / max(smileL, smileR, ε)` |
| `corner_height_diff` | roll-corrected `|yL − yR| / IOD` in the smile frame |
| `eye_aperture_asym` | lid gap asymmetry (secondary — ptosis) |
| `smile_strength` | mean smile blendshape (quality gate; < 0.3 → `needsRetry`) |

Severity = weighted ramp: `0.45·ramp(lift_asym) + 0.25·ramp(smile_bs_asym) + 0.20·ramp(corner_height_diff) + 0.10·ramp(eye_aperture_asym)` where `ramp(x; lo, hi)` clamps `(x−lo)/(hi−lo)` to [0,1]. Initial (**uncalibrated**) ramps: `lift_asym 0.15→0.5`, `smile_bs_asym 0.2→0.6`, `corner_height_diff 0.02→0.07`, `eye_aperture_asym 0.15→0.4`. `side` = the side with the smaller lift, reported as patient's left/right.

Confidence = min of: face-detected frame ratio, yaw within ±15° (from transform matrix), face width ≥ 20 % of frame width, mean frame brightness in a sane range, smile_strength gate.

## Arms test ("Raise both arms out and hold")
Protocol (10 s): first the patient **steps back** (framing gate above), then "Hold both arms straight out to your sides, palms up." Default is arms out to the **sides** (2D pose is far more reliable than arms pointing at the camera). After the 3-2-1 cue, measure 10 s.

Landmarks (BlazePose): shoulders `11/12`, elbows `13/14`, wrists `15/16`. Require `visibility ≥ 0.5` for shoulders + wrists.

Per frame, per arm: **elevation angle** `θ = atan2(shoulder.y − wrist.y, |wrist.x − shoulder.x|)` in degrees (0° = horizontal, + = above). Smooth with a 5-frame median.

Metrics:
| Metric | Definition |
|---|---|
| `drift_L`, `drift_R` | median θ in first 2 s − median θ in last 2 s (deg) |
| `drift_asym` | `|drift_L − drift_R|` — primary |
| `height_diff` | mean `|wristL.y − wristR.y| / shoulderWidth` over hold |
| `min_theta_L/R` | lowest sustained θ; below −25° = arm dropped |
| `raised_time_L/R` | seconds the arm stayed within 20° of its starting θ |

Severity = `0.55·ramp(drift_asym; 8→30) + 0.25·ramp(height_diff; 0.08→0.35) + 0.20·(one arm never rose above −10° ? 1 : 0)`.
Both arms sinking equally is fatigue, not stroke → contributes via `drift_asym` only (≈0); add flag `"both arms drifted equally"`.
Confidence = joint visibility ratio, both wrists/elbows/shoulders in frame (the framing gate above must have passed), shoulder width ≥ 9 % of frame width.

## Eyes test — BE-FAST stretch (`FEATURES.eyesTest`, off by default)
Build only after the FAST MVP is demo-stable. Files: `frontend/src/lib/vision/eyes.ts` (pure metrics), a stimulus component that moves a dot on screen. Output: a `TestResult` with `test: "eyes"`.

Protocol (~10 s, patient still **close** to the screen, same framing gate as the face test): "Keep your head still and follow the dot with your eyes only." Dot sequence: center 1 s → left 2 s → center 1 s → right 2 s → center 1 s (optional up/down).

Landmarks: iris centers `468` and `473`, eye corners `33/133` and `362/263` (verify mapping with the debug overlay). Per eye, **horizontal gaze ratio** = (iris.x − outer corner.x) / (inner corner.x − outer corner.x), roll-corrected and head-yaw compensated (or frames rejected when |yaw| > 10°).

Metrics: `exc_left`, `exc_right` (gaze-ratio excursion from the center baseline when the dot is left/right, per eye), `excursion_asym = |exc_left − exc_right| / max(...)` (gaze palsy: cannot look one way), `conjugacy_err` (difference between the two eyes' excursions; dysconjugate gaze), `rest_deviation` (mean offset while the dot is centered; fixed gaze deviation), `tracking_lag_s`.
Severity: `0.5·ramp(excursion_asym) + 0.3·ramp(conjugacy_err) + 0.2·ramp(rest_deviation)` with **uncalibrated** ramps; max risk weight 0.3 (glasses, strabismus, small eyes cause false positives).
Confidence: iris landmarks visible, |yaw| stable, brightness, dot-following actually happened (gaze moved at all). Low confidence → `needsRetry`, never a guess.
Stretch of the stretch: visual-field check (dots flash at screen edges while gaze stays at the center; patient taps a key when seen). Skip nystagmus and pupil response (30 fps webcam is too noisy).

Enabling it touches: `FEATURES.eyesTest`, agent tool `start_eye_test` (spec 04), dashboard card (auto-shown when flag is on), demo panel slider, risk weight (`MAX_WEIGHTS.eyes`). Contracts already include `eyes`.

## Second opinion (stretch, non-blocking)
- Capture one JPEG at peak smile and one at end of arm hold (client canvas, ≤512 px, quality 0.7). Only send after the consent checkbox.
- `POST /api/vision/second-opinion` → `models/vision.py` calls Anthropic (`ANTHROPIC_MODEL`) with a strict JSON-only prompt: *"Describe observable facial/arm asymmetry in these images. You are not diagnosing. Return JSON matching VisionOpinion."* Validate with Pydantic; on any failure return `unclear`.
- Folded into the risk score as the `vision` contribution (low weight, see 05). Show it on the dashboard labelled "AI second opinion". A timeout or failure must never delay the session.

## Tests to write first
- Fixture landmark JSONs: symmetric smile, left-droop, right-droop, head rolled 20°, low confidence. Assert `side`, monotonic severity, and roll invariance.
- Synthetic arm trajectories: both steady, one drops 30°, both drop 20°, one never rises.
