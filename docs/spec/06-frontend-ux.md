# 06 — Frontend UX, Session State & Demo Mode

Owner: Frontend dev. Files: `frontend/src/**` (except `lib/vision`, `lib/speech`, `lib/risk.ts`).

## Session state machine (Zustand store, single source of truth)
```
idle → consent → intro → lastKnownWell → face → [eyes, only if FEATURES.eyesTest] → speech → arms → scoring
(order comes from `testSequence()` in `config.ts`; progression is "first test without a usable result", so it tolerates retries and out-of-order completion)
scoring → clear                       (risk < threshold)
scoring → countdown → alerting → alerted   (risk ≥ threshold)
any state → countdown  (user_request via agent tool or button)
countdown → intro/cancelled            (user cancels)
```
Store shape (minimum): `phase`, `results: Partial<Record<TestName, TestResult>>`, `opinions`, `risk: RiskBreakdown | null`, `lastKnownWell`, `location`, `agentConnected`, `alertStatus`, `demo: {enabled, overrides}`.
Transitions are functions on the store (`startFace()`, `completeTest(result)`, …); agent tools and UI buttons call the **same** functions.

## Screens / layout (single page, desktop-first)
- **Consent modal**: camera + mic + location, "not a medical device", optional checkbox for sending still images for AI second opinion. Starts audio (user gesture) and the agent.
- **Main**: left — mirrored camera view with landmark overlay and a big instruction caption; right — stepper (Face / Arms / Speech / Verdict), agent captions, live **risk dashboard**.
- **Risk dashboard**: per-test card (severity bar, confidence chip, flags, raw metrics in an expandable table), combined risk gauge with threshold marker, breakdown of contributions. This is a judge-facing showpiece.
- **Countdown modal**: 10 s ring, "Cancel", reason line, agent script captioned.
- **Alert status**: "Calling demo number… ✓ sent", with dry-run badge when applicable.
- Persistent footer: manual "Call 911" (`tel:`) and "I'm OK — cancel".

## UX rules
- Every test shows: instruction text, progress ring, and a live **positioning hint** from the framing gate (`store.hint`): "move a little closer", "move back a little", and before arms "step back until I can see both hands". A framing indicator (green outline / red outline) around the camera view helps.
- The camera view should show a "stand here" guide for arms (a silhouette or a body-width guide) so the far position is obvious.
- Low-confidence result → automatic "let's try that again" (max 1 retry), never a silent pass.
- Large tap targets, high contrast, accessible captions (patient may be impaired).
- No blocking spinners > 3 s without status text.

## Demo / simulation mode
Enabled with `?demo=1` or `Shift+D`. Shows a floating **Demo Panel**:
- Sliders to override each test's severity/confidence; "Simulate stroke" (face 0.8 + arms 0.7 + speech 0.7) and "Simulate healthy" presets.
- Toggle "Skip live capture" (results come from overrides instantly) and "Trigger countdown now".
- Shows `DRY_RUN` status from `/api/health`; loud red badge when live calls are armed.
- Overrides go through the normal `completeTest` path so scoring, dashboard, agent context, and alert code all run for real.
- Keep the demo panel out of the default UI unless enabled.

## Performance & reliability
- Load MediaPipe models on the consent screen (warm up) so tests start instantly.
- Cap detection to ~20 fps; avoid React state per frame (use refs/canvas for overlay).
- Handle: camera denied, mic denied, no webcam, model load fail, backend down → each has an on-screen fallback and demo-mode escape hatch.

## Frontend tests
- Vitest for `risk.ts` and metric functions; a store test walking the state machine with fake results; skip visual tests.
