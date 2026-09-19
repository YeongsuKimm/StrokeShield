# 02 — Vision: Face & Arms (+ second opinion)

Owner: Vision dev. Files: `frontend/src/lib/vision/*`, `models/vision.py`, `backend/routers/vision.py`.
Output: two `TestResult`s (`face`, `arms`) and optional `VisionOpinion[]`.

## Runtime
- `@mediapipe/tasks-vision`: `FaceLandmarker` (`outputFaceBlendshapes: true`, `outputFacialTransformationMatrixes: true`) and `PoseLandmarker` (lite/full), `runningMode: "VIDEO"`, GPU delegate with CPU fallback. Load model files from `frontend/public/models/` (don't fetch from a CDN on demo day).
- Run detection with `requestAnimationFrame` on the `<video>`; throttle to ~15–30 fps. Keep detection out of React render; push summaries into the store at ≤5 Hz.
- Metric functions take plain arrays (`{x,y,z,visibility}[]`) so they can be unit-tested with JSON fixtures.
- Verify landmark index ↔ anatomy with the debug overlay early, and record the verified left/right mapping in a code comment. (Reference indices below are the standard MediaPipe Face Mesh / BlazePose ones.)

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
Protocol (10 s): "Hold both arms straight out to your sides, palms up." Default is arms out to the **sides** (2D pose is far more reliable than arms pointing at the camera). Give 3 s to get into position, then measure 10 s.

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
Confidence = joint visibility ratio, arms in frame, subject distance (shoulder width 25–60 % of frame).

## Second opinion (stretch, non-blocking)
- Capture one JPEG at peak smile and one at end of arm hold (client canvas, ≤512 px, quality 0.7). Only send after the consent checkbox.
- `POST /api/vision/second-opinion` → `models/vision.py` calls Anthropic (`ANTHROPIC_MODEL`) with a strict JSON-only prompt: *"Describe observable facial/arm asymmetry in these images. You are not diagnosing. Return JSON matching VisionOpinion."* Validate with Pydantic; on any failure return `unclear`.
- Folded into the risk score as the `vision` contribution (low weight, see 05). Show it on the dashboard labelled "AI second opinion". A timeout or failure must never delay the session.

## Tests to write first
- Fixture landmark JSONs: symmetric smile, left-droop, right-droop, head rolled 20°, low confidence. Assert `side`, monotonic severity, and roll invariance.
- Synthetic arm trajectories: both steady, one drops 30°, both drop 20°, one never rises.
