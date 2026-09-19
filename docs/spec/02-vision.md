# 02 — Vision: Face & Arms (+ second opinion)

Owner: Vision dev. Files: `frontend/src/lib/vision/*`, `models/vision.py`, `backend/routers/vision.py`.
Output: two `TestResult`s (`face`, `arms`) and optional `VisionOpinion[]`.

## Runtime
- `@mediapipe/tasks-vision`: `FaceLandmarker` (`outputFaceBlendshapes: true`, `outputFacialTransformationMatrixes: true`) and `PoseLandmarker` (lite/full), `runningMode: "VIDEO"`, GPU delegate with CPU fallback. Load model files from `frontend/public/models/` (don't fetch from a CDN on demo day).
- Run detection with `requestAnimationFrame` on the `<video>`; throttle to ~15–30 fps. Keep detection out of React render; push summaries into the store at ≤5 Hz.
- Metric functions take plain arrays (`{x,y,z,visibility}[]`) so they can be unit-tested with JSON fixtures.
- Verify landmark index ↔ anatomy with the debug overlay early, and record the verified left/right mapping in a code comment. (Reference indices below are the standard MediaPipe Face Mesh / BlazePose ones.)

## Shared conventions (face, arms, eyes must all follow these)
The three tests are built independently but feed ONE noisy-OR risk score (spec 05), so they share one scale. `frontend/src/lib/vision/consistency.test.ts` enforces most of this; run it when you change any threshold.
- **Severity anchors (0..1):** healthy people with normal natural asymmetry ≤ 0.15; borderline / ambiguous ≈ 0.3–0.4 (never alerts alone); clear one-sided deficit ≥ 0.85. Calibrate ramps to these anchors, and test them.
- **Confidence and retry:** confidence is 0..1 (1 = ideal capture). Return `needsRetry: true` when confidence < `MIN_CONFIDENCE` (`config.ts`, 0.3, never redefined per test) or data is insufficient; then `severity = 0`, confidence stays just under the cutoff, and `flags[0]` is a short spoken-style reason (lower-case, no trailing period) the UI/agent can read out. Never a confident guess.
- **Left/right:** `side` and `_left` / `_right` metric suffixes are the PATIENT'S own left/right, computed from RAW (unmirrored) camera coordinates; the patient's left appears on the image RIGHT. The mirrored display is only a draw-layer concern. The mapping is ASSUMED until confirmed on a live camera with `?debug=1` (flags: `FACE_CONFIG.blendshapeLeftIsPatientLeft`, `ARMS_CONFIG.swapLeftRight`).
- **Units and naming:** frame time `t` in ms (`performance.now()` style; analyzers convert `startedAt` to epoch ms via `vision/time.ts`), durations in seconds (`*_s`, except `raised_time_*`, which is seconds), angles in degrees, every metric a finite number.
- **Aspect ratio:** MediaPipe landmarks are normalized per axis, so angles need the real video aspect: pass `video.videoWidth / videoHeight` (face: `aspect` on each frame; arms: `opts.aspectRatio`; eyes: `opts.aspect`). Default 16:9 if omitted.
- **Yaw:** face test tolerates |yaw| ≤ 15° (degrades to 0 confidence at 25°); eyes rejects frames above 10°. The capture layer should hint "Look straight at the screen" before a test starts.
- **Config:** each test keeps thresholds in one exported const (`FACE_CONFIG`, `ARMS_CONFIG`, `EYES_CONFIG`) with a unit comment per value, all UNCALIBRATED until tuned on teammate recordings. Face-width confidence uses the same scale in face and eyes (0.12 → 0, 0.20 → 1 of frame width).
- **Contract for the risk score:** eyes has max weight 0.3 (corroborates, can't alert alone); face and arms 0.6.

## Calibration workflow
Thresholds are tuned by **record → replay → tune**: `?record=1` saves the exact analyzer inputs of live runs (labelled with scenario/expected side), `pnpm calibrate` replays them offline against the anchors above and prints false alarms, misses, wrong sides and retry rate. Full guide: [../CALIBRATION.md](../CALIBRATION.md); proof protocol (held-out split, freeze, criteria): [../VALIDATION.md](../VALIDATION.md). Recordings carry optional `conditions` and `env` (schema stays 1). Code: `frontend/src/lib/calibration/`.
Eyes records the labelled `EyeFrame[]` actually passed to `analyzeEyes`, with healthy and mimicked cannot-look-left/right scenarios. This keeps replay independent of later protocol-timing changes.

## Positioning: close for the face, back for the arms
The face needs to fill enough of the frame for reliable landmarks; the arms test needs the whole upper body **and both hands** in frame. One camera can't do both, so the session is ordered **Speech → Eyes → Face → Arms** (`testSequence()` in `config.ts`, matching the UX storyboard): the patient starts close to the screen (~50–70 cm / arm's length; better landmarks, and the mic is close for speech), then steps back **once** (~2 m / 6 ft) for the arms. The first three are all close-up, so their order among themselves is a UX choice, not a vision constraint; arms must stay last.

Before each test, run a **framing gate** (`frontend/src/lib/vision/framing.ts`, pure, already implemented + tested):
- `checkFaceFraming(faceLandmarks)` — face width within 18–60 % of the frame and not touching an edge. Hints: "Move a little closer to the screen." / "Move back a little." / "Center your face in the view."
- `checkArmFraming(poseLandmarks)` — both shoulders, elbows **and wrists** visible (≥ 0.5) and inside the frame; shoulder width ≥ 9 % of frame width (not too far). Hints: "Step back until I can see both hands and both shoulders." / "Move a little closer."
- Thresholds are in `FRAMING_LIMITS` (uncalibrated; tune in the actual demo room).
- The test starts only after framing has been OK for `holdOkMs` (1.5 s) continuously. If it never gets OK within `waitTimeoutMs` (12 s), the tool returns a retry result ("couldn't see both hands") rather than scoring garbage. The UI leaves that reason visible for 2 s and automatically starts one fresh attempt; the retry is tracked as pending so the manual button cannot flash or start a competing run. After a second failed attempt it offers a visible **Try again** button.
- The current hint goes into the store (`setHint`) as an on-screen caption, and the agent tool result / `sendContextualUpdate` lets the assistant say it aloud.
- Once framing is OK for the arms test: caption "Get ready… 3, 2, 1, raise your arms," then the 10 s measurement.

Demo-room checklist: ~2.5 m of clear floor behind the patient's start position, camera at about chest/face height, tape a mark on the floor for the "far" spot, good front lighting. Test the room before the demo; wide-angle webcams help.

## Face test ("Show me a big smile")
Protocol (~8 s): (1) "Relax your face" — 1.5 s **neutral** capture. (2) "Now smile as big as you can and hold" — 3 s **smile** capture. Retry once if smile is not detected or the neutral capture starts with a smile; after the automatic retry, the UI offers **Try again** rather than leaving the camera screen idle.

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

As built (`vision/face.ts`, `analyzeFace(neutral, smile)`, extra frame fields `brightness`, `aspect`; changes from the text above):
- **Smile gate:** the *stronger side's* smile blendshape must reach 0.3 (plus a mean floor of 0.15). A mean-only gate would wrongly reject a severe droop where one side barely moves. `smile_strength` is still reported as the mean.
- **Neutral capture must not be smiling** (> 0.35 → retry): a pre-smile destroys the lift measurement. During the 2 s retry pause, the screen explicitly says **Relax your face** before restarting.
- **Roll correction needs the real frame aspect** (see conventions).
- **Blendshape left/right** (`mouthSmileLeft` = patient's left?) is ~50/50 unresolved; it only drives the "blendshape and landmark disagree" flag. Severity and `side` come from landmarks (Face Mesh 61/159/145 = patient's RIGHT, 263/291/386/374 = patient's LEFT — assumed, from the mesh's subject-perspective annotation).
- Minimum frames: ≥ 5 detected neutral, ≥ 8 detected smile (~15 fps: neutral 1.5 s, smile 3 s). Pass `landmarks: []` frames for missed detections.
- Known limits: no pitch correction, glasses/dentures/old palsy not handled, `corner_height_diff` is measured in the smile frame only (natural baseline asymmetry counts).

## Arms test ("Raise both arms out and hold")
Protocol (10 s): first the patient **steps back** (framing gate above), then "Hold both arms straight out to your sides, palms up." Default is arms out to the **sides** (2D pose is far more reliable than arms pointing at the camera). After the 3-2-1 cue, measure 10 s.

Landmarks (BlazePose): shoulders `11/12`, elbows `13/14`, wrists `15/16`. Require `visibility ≥ 0.5` for shoulders + wrists.

Per frame, per arm: **elevation angle** `θ = atan2(shoulder.y − wrist.y, |wrist.x − shoulder.x|)` in degrees (0° = horizontal, + = above). Smooth with a 5-frame median.

Metrics:
| Metric | Definition |
|---|---|
| `drift_left`, `drift_right` | median θ in first 2 s − median θ in last 2 s (deg) |
| `drift_asym` | `|drift_L − drift_R|` — primary |
| `height_diff` | mean `|wristL.y − wristR.y| / shoulderWidth` over hold |
| `min_theta_left/right` | lowest sustained θ (1 s rolling median); below −25° = arm dropped |
| `raised_time_left/right` | seconds until θ first fell more than 20° below its starting θ (0 if the arm never rose) |

Severity (as built, `ARMS_CONFIG`) = `0.6·ramp(drift_asym; 8→25°) + 0.3·ramp(height_diff; 0.10→0.40) + 0.1·neverRose`, with a **floor of 0.9 when exactly one arm never rose** (sustained θ ≤ −10°; a hanging arm has no drift, so the formula alone can't express it). The original spec weights (0.55/0.25/0.20, 8→30) capped a clear 30° drop at 0.80, below the shared 0.85 anchor. Measured: steady 0, natural asymmetry ≈ 0.07, one arm 14° → 0.36, 20° → 0.68, ≥ 25° → ~0.9. Neither arm rising → `needsRetry` (`neither arm was raised`): the patient probably didn't do the test, and bilateral weakness alone shouldn't alert. `side` is `'both'` for the equal-drift fatigue case (severity ≈ 0) and `'none'` when nothing is notable.
Both arms sinking equally is fatigue, not stroke → contributes via `drift_asym` only (≈0); add flag `"both arms drifted equally"`.
Confidence = min(visibility score, duration score): fraction of frames with all six joints visible, in frame, and shoulders ≥ 9 % of frame width (0 at 40 %, 1 at 85 %), and data span (0 at 3 s, 1 at 8 s). Needs ≥ 6 s and ≥ 30 usable frames. Feed ONLY the 10 s hold window (clock starts after the 3-2-1 cue; a window that starts while the arms are still rising biases the start median low). Limits: arms toward the camera are unreliable in 2D (`poseWorldLandmarks` would fix it and the aspect issue; not built); a naturally low arm scores ≈ 0.2.

## Eyes test — BE-FAST (`FEATURES.eyesTest`, **now ON**)
Wired into the live flow and part of the default test order (see "Positioning" above). Files: `frontend/src/lib/vision/eyes.ts` (pure metrics), `eyeProtocol.ts` (dot sequence + frame labelling), `createEyesCapture` in `capture.ts`, `runEyes` in `useTestRunner.ts`, `components/EyeStimulus.tsx` (the dot), `components/test/EyeTest.tsx` (the screen). Output: a `TestResult` with `test: "eyes"`.

**Still unverified on a real camera, and uncalibrated** — the left/right landmark mapping is reasoned, not confirmed. Verify with `?debug=1` and calibrate before the demo; turn the flag back off if it misbehaves.

Protocol (~10 s, patient still **close** to the screen, same framing gate as the face test): "Keep your head still and follow the dot with your eyes only." Dot sequence: center 1 s → left 2 s → center 1 s → right 2 s → center 1 s (optional up/down).

Landmarks: iris centers `468` and `473`, eye corners `33/133` and `362/263` (verify mapping with the debug overlay). Per eye, **horizontal gaze ratio** = (iris.x − outer corner.x) / (inner corner.x − outer corner.x), roll-corrected and head-yaw compensated (or frames rejected when |yaw| > 10°).

Metrics: `exc_left`, `exc_right` (gaze-ratio excursion from the center baseline when the dot is left/right, per eye), `excursion_asym = |exc_left − exc_right| / max(...)` (gaze palsy: cannot look one way), `conjugacy_err` (difference between the two eyes' excursions; dysconjugate gaze), `rest_deviation` (mean offset while the dot is centered; fixed gaze deviation), `tracking_lag_s`.
Severity (as built, `EYES_CONFIG`): `max(0.5·ramp(excursion_asym; 0.3→0.8) + 0.3·ramp(conjugacy_err; 0.3→0.8) + 0.2·ramp(rest_deviation; 0.08→0.22), 0.9·ramp(excursion_asym))`. The `max` term is deliberate: the plain weighted sum caps a pure one-sided gaze palsy at 0.5, below the 0.85 anchor. Ramps are wide because natural left/right amplitude differs by ~0.1–0.3. Units are eye widths (a dot 13–20° off-center moves the iris ~0.08–0.15 eye widths; webcam jitter ~0.01–0.02 — reasoned, not measured). `rest_deviation` is |mean centered gaze − 0.5|, which real eye geometry offsets by ~±0.05. `tracking_lag_s` only raises a "slow to follow" flag (> 1.2 s); it is not in severity. `side` is set only when `excursion_asym` ≥ 0.4. Max risk weight 0.3 (glasses, strabismus, small eyes cause false positives).
Implementation notes: `EyeFrame = { face: FaceFrame; target: 'center'|'left'|'right' }`, `target` in the PATIENT's own left/right (physical screen-left = patient-left when they face the screen; set `EyeStimulus mirrored` only if an ancestor is CSS-flipped). Label frames with `labelEyeFrames(faces, protocolStartT)` using the same `performance.now()` clock as `EyeStimulus.onTargetChange`. The first 500 ms and first half of every segment are skipped (so 2 s left/right segments are measured over the last second). If gaze moves opposite to the dot the result is a retry ("check left/right labeling"). Eye landmarks 33/133/468 = patient's RIGHT eye, 263/362/473 = patient's LEFT eye (assumed, ~90 %). Known limits: yaw > 10° is rejected not compensated, no vertical gaze, conjugacy modeled as amplitude difference, slow followers underestimated.
Confidence: iris landmarks visible, |yaw| stable, brightness, dot-following actually happened (gaze moved at all). Low confidence → `needsRetry`, never a guess.
Stretch of the stretch: visual-field check (dots flash at screen edges while gaze stays at the center; patient taps a key when seen). Skip nystagmus and pupil response (30 fps webcam is too noisy).

As wired: `createEyesCapture` opens ONE capture window exactly `EYE_PROTOCOL_TOTAL_MS` long, gated by the face framing gate plus the tighter `EYES_CONFIG.maxYawDeg` yaw limit. `EyeTest` mounts `<EyeStimulus>` when `progress.phase === 'hold'`, i.e. as that window opens, so the analyzer can take the first collected frame's timestamp as the protocol start (sync error: one camera frame against 1–2 s dot segments). The dot is rendered OUTSIDE the mirrored layer, so `mirrored` stays false. Still open: the agent tool `start_eye_test` (spec 04) is not registered yet.

## Second opinion (stretch, non-blocking)
- Capture one JPEG at peak smile and one at end of arm hold (client canvas, ≤512 px, quality 0.7). Only send after the consent checkbox.
- `POST /api/vision/second-opinion` → `models/vision.py` calls Anthropic (`ANTHROPIC_MODEL`) with a strict JSON-only prompt: *"Describe observable facial/arm asymmetry in these images. You are not diagnosing. Return JSON matching VisionOpinion."* Validate with Pydantic; on any failure return `unclear`.
- Folded into the risk score as the `vision` contribution (low weight, see 05). Show it on the dashboard labelled "AI second opinion". A timeout or failure must never delay the session.

## Tests to write first
- Fixture landmark JSONs: symmetric smile, left-droop, right-droop, head rolled 20°, low confidence. Assert `side`, monotonic severity, and roll invariance.
- Synthetic arm trajectories: both steady, one drops 30°, both drop 20°, one never rises.
