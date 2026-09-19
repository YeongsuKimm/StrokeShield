# 06 — Frontend UX, Session State & Demo Mode

Owner: Frontend dev. Files: `frontend/src/**` (except `lib/vision`, `lib/speech`, `lib/risk.ts`).

## Session state machine (Zustand store, single source of truth)
```
idle → [eyes, only if FEATURES.eyesTest] → face → arms → speech → scoring
(order comes from `testSequence()` in `config.ts`; progression is "first test without a usable result AND not skipped",
 so it tolerates retries, skips and out-of-order completion)
scoring → clear                       (risk < threshold)
scoring → countdown → alerting → alerted   (risk ≥ threshold)
any state → countdown  (user_request via agent tool or button)
countdown → cancelled                 (user cancels)
```
`consent` / `intro` remain in the `Phase` union but are unused: consent is a panel on the home screen, not a gate.
Store shape: `route ('home'|'info')`, `phase`, `results`, `skipped: TestName[]`, `opinions`, `risk`, `lastKnownWell`,
`location`, `permissions {camera,microphone,location}`, `agentConnected`, `transcript: TranscriptLine[]`, `micMuted`,
`alertStatus`, `alertResponse`, `demoEnabled`, `hint`.
Transitions are functions on the store (`beginTests()`, `completeTest(result)`, `skipTest(test)`, …); agent tools and
UI buttons call the **same** functions.

## Screens (two documents: the check, and the info page)
Routing is `store.route` plus `store.phase` — no router library. `App.tsx` picks the screen.
- **Home** (`HomePage`): consent panel (camera / mic / location, each with its reason and live grant state) beside the
  hero and "Start the test". Sustained downward input opens the info document and **commits** (no half-scrolled state). The gesture lives in
  `lib/useScrollHandoff.ts` and is shared with the info page, which uses it in the other direction: **scrolling up
  past the top of the info page returns to the check**, alongside the "Back to the check" button (kept, since the
  gesture is only a shortcut). 186 px of wheel travel down / 287 px up (`HANDOFF_BUFFER_PX`; the way back asks for more, so a stray upward scroll can't eject the reader), a swipe (152 / 220 px), or ↓/PageDown/End (↑/PageUp/Home
  on info), counted only within 160 px of the relevant page edge. Travel fades slowly (0.97 per 100 ms) so a
  one-notch-a-second mouse wheel still adds up; a lone flick does not fire it; a 700 ms cooldown after each hand-off
  stops trackpad inertia bouncing you straight back. The home direction only listens while `phase === 'idle'`. The
  page itself is never scroll-locked.
- **Test screens** (`TestScreen` + `SpeechTest` / `EyeTest` / `FaceTest` / `ArmsTest`): progress dots, one big
  instruction, the stage, the assistant transcript strip, the mute warning, and the skip hatch.
- The persistent ElevenLabs voice-guide control stays at the top center of the viewport (from `sm` up) so it remains
  available without overlapping the bottom-right skip control. On phones the header fills the top edge, so it drops to
  the bottom-right (button only; status text is screen-reader only), opposite the Call 911 button.
- `reset()` (logo, "Run the check again", info-page "Start the test", demo reset) clears the session but keeps
  browser facts: `permissions` and `agentConnected`. Alert actions are phase-guarded: `cancelCountdown` /
  `confirmCountdown` only act during `countdown`, `setAlertResult` only during `alerting` (a response arriving after a
  reset is dropped), and `requestEmergency` is ignored while an alert is in flight (no double SMS).
- The speech screen starts recording only from the user's **Start recording** button. The voice agent waits for that
  result and cannot start the microphone through its client tool.
- **Info** (`InfoPage`): process (BE-FAST), why, stats (digits roll up from zero via `ui/SlotNumber` when scrolled into view), Q&A + hotlines, team (names + Johns Hopkins University). The header logo resets the session and returns home. Reached from the header menu too.
- **Header menu** (`chrome/SiteHeader` + `ui/DrilldownMenu` + `chrome/menuTree.ts`): a drilldown list. Collapsed it shows
  ONE row, "Learn more" ("Sections" on the info page); opening it reveals the sections, and "The process" (Speech, Eyes,
  Face, Arms, Time) and "Questions & hotlines" (Hotlines, Common questions) drill one level deeper. The clicked row
  stays put and greys into a breadcrumb; click it to step back. Leaves jump to an element id on the info page, so
  every target needs an id there (`process`, `step-*`, `why`, `stats`, `help`, `hotlines`, `faq`, `team`). The logo
  returns to the idle homepage from any phase. Collapses on
  Escape, outside click and after a choice. The component is adapted from **Drilldown Menu by ruixen.ui on 21st.dev**
  (retrieved with `npx @21st-dev/cli get`, not `add`: the CLI's install path runs `shadcn add`, which would init shadcn
  and rewrite `index.css`). New dependency: `framer-motion` (~+159 kB gzipped on the main bundle).
- **Result** (`ResultScreen`): banner in one of three bands, three actions (call 911 / alert a contact / ER nearby),
  alert status with dry-run badge, and the risk dashboard underneath.
- **Risk dashboard** (`Dashboard`): per-test card (severity bar, confidence, max weight, flags, raw metrics in an
  expandable table), combined risk gauge with threshold marker, and the per-test noisy-OR arithmetic. Judge-facing.
- **Countdown modal**: ring, reason line, big "Cancel — I am OK" (autofocused, Escape also cancels; `<main>` is `inert`
  behind it; the voice-cancel hint shows only while the agent is connected), and a direct
  `tel:911` link. Copy says "emergency contact", never "911", because the backend only ever texts `DEMO_PHONE_NUMBER`.
- Persistent floating "Call 911" (`tel:`) on every screen, every phase.

### Result bands (UI only)
`resultBand(risk)` in `config.ts`: `high` at ≥ `RISK_THRESHOLD`, `caution` at ≥ `CAUTION_RISK` (0.2, **uncalibrated**),
else `low`. The alert trigger is still `RISK_THRESHOLD` alone (spec 05) — the middle band only changes what the
result screen says and offers.

## Design system
- Tokens in `src/index.css` under `@theme`: warm bone page, off-black ink (never `#000`), ONE accent (deep clinical
  blue `#0b5cab`), red reserved for emergency, plus `ok` / `caution`. Every pairing is ≥ 4.5:1 on its background.
  **No gradients anywhere.** One shadow, tinted to the paper hue.
- The camera stage is its own dark material (`--color-stage`) inset into the light chrome, so it reads as a
  viewfinder. Its ring carries the framing verdict: neutral → `caution` → `ok`.
- Type: exactly TWO faces. **Tiempos** for titles (every h1-h3, the wordmark, the speech sentence, big display numerals)
  and **Avenir** for everything else, including the uppercase micro-labels and all numbers (`.tnum` for tabular
  figures). Both are commercial, so `--font-serif` / `--font-sans` in `index.css` lead with the real font (used
  automatically where installed; Avenir Next ships with macOS/iOS) and fall back to bundled free look-alikes,
  **Newsreader** (for Tiempos) and **Nunito Sans** (for Avenir), self-hosted via `@fontsource-variable/*`. The
  title rule is deliberately unlayered so it beats Tailwind's weight/tracking utilities. To get real Tiempos on the
  deployed site, add licensed `.woff2` files under `public/fonts/` and `@font-face` them as `Tiempos Headline` /
  `Tiempos Text`. `--font-mono` remains only for the dev panels (`?debug=1`, `?record=vision`, `?record=speech`; legacy `?record=1` combines both recorders).
- **Type floor:** nothing user-facing is below 13 px. Uppercase micro-labels are 13 px bold; secondary text is 14-15 px;
  body is 16 px+ (raised from an 11 px floor).
- Icons are inline SVG primitives (`ui/Icon.tsx`), one 24px grid at 1.75 stroke. No icon dependency, no emoji.
- Cursor: 2x default size, as SVG data-URI cursors (arrow / hand / I-beam; under the 128 px browser cap).
- Motion is CSS-only (transform/opacity), and `prefers-reduced-motion` disables all of it.

## UX rules
- Every test shows: instruction text, progress ring, and a live **positioning hint** from the framing gate
  (`store.hint`). The stage ring is the framing indicator. The bottom caption is suppressed while merely waiting for
  position, since the hint pill and the page heading already say it.
- The camera view shows a "stand here" guide: `HeadGuide` for the close-up checks (sized as a % of frame WIDTH, to
  match the face-width gate) and `BodyGuide` for arms (anchored to frame height), plus two reference pictures (`public/images/arms-stand.jpg`, `arms-raise.jpg`) beside the camera.
- **Skip hatch:** after `SKIP_OFFER_MS` (15 s) on any check, a "Skip this check" card appears, **pinned to the bottom-right of the window** (`position: fixed`), so it is
  visible however short the screen while staying clear of the centred controls (Start recording, camera captions) and
  the bottom-left Call 911 button. It is a bordered accent-blue card with a large button and a spring-in entrance,
  and an `aria-live` region so screen readers announce it. On phones it becomes a compact full-width row above the
  Call 911 button, and the page gains bottom padding so controls can scroll clear of it. A skipped test is
  excluded from progression and contributes nothing to the score. A framing gate that never passes can never trap
  the patient.
- Low-confidence or invalid vision capture → keep the reason visible for 2 s, then automatically retry once. If the
  second attempt also fails, leave a visible **Try again** button under the camera; never leave an idle camera screen
  with Skip as the only action. The pause is explicit UI state, so **Try again** stays hidden until the automatic retry
  has finished; for a pre-smile, the heading switches to **Relax your face** during that pause. The framing timeout is
  12 s so the automatic retry begins before the 15 s skip hatch.
- Large tap targets, high contrast, accessible captions (patient may be impaired). Visible focus rings everywhere,
  including on the dark stage.
- No blocking spinners > 3 s without status text.
- The mute warning only fires for a microphone we actually hold (`evaluateMic`), never as a guess.

## Demo / simulation mode
Enabled with `?demo=1` or `Shift+D`. Shows a floating **Demo Panel**:
- Sliders to override each test's severity/confidence; "Simulate stroke" (face 0.8 + arms 0.7 + speech 0.7) and "Simulate healthy" presets.
- Toggle "Skip live capture" (results come from overrides instantly) and "Trigger countdown now".
- Shows `DRY_RUN` status from `/api/health`; loud red badge when live messaging is armed.
- Overrides go through the normal `completeTest` path so scoring, dashboard, agent context, and alert code all run for real.
- Keep the demo panel out of the default UI unless enabled.

## Never a dead screen (vision checks)
Every vision check screen must always show something to see or press: a run in progress, an automatic retry about to start, an accepted result, or a **Try again** button. The button appears after a failed attempt and, as a safety net, whenever the check has gone idle with no result for ~0.8 s (e.g. another test cancelled it). The logic is the pure `visionActionState` in `lib/vision/retry.ts`; `vision/retryJourney.test.ts` simulates the whole patient journey against it. The runner (`useTestRunner.start`) must never leave its slot occupied after a crash.

**Leaving a check stops it.** A check screen is "active" only while `phase === test` AND `route === 'home'` (`isVisionScreenActive`); opening the info page unmounts the screen without changing the phase, so the vision screens cancel their run on unmount and the pending automatic retry will not start a hidden capture. The speech step does the same through `cancelSpeechOnPhaseExit` (phase leaves `speech`, or the info page opens): the recording is aborted, nothing is stored, a waiting agent tool is released, and the stale retry hint is cleared. A run that was told to cancel is never joined by a new request for the same check (the new request starts a fresh capture), and a camera left in the `error` state is restarted by the next attempt so **Try again** can recover from a transient camera failure.

## Performance & reliability
- MediaPipe models load when the page mounts (as built; the camera permission prompt therefore appears immediately). Models are committed in `frontend/public/models/`; wasm is copied from `node_modules` on `pnpm install`, so nothing depends on a CDN on demo day.
- Cap detection to ~20 fps; avoid React state per frame (use refs/canvas for overlay).
- Handle: camera denied, mic denied, no webcam, model load fail, backend down → each has an on-screen fallback and demo-mode escape hatch.

## Frontend tests
- Vitest for `risk.ts` and metric functions; a store test walking the state machine with fake results (including the
  skip paths); `evaluateMic` for the mute verdict; skip visual tests.

## Known gaps in the UI (wired to stubs, fails visibly)
- **Voice agent:** `TranscriptStrip` renders `store.transcript` and shows "not connected". `useAgent` should push
  utterances via `addTranscript('agent', text)` — no change needed here once it does.
- **Speech:** `SpeechTest` drives `speechRunner.runSpeech()` (lib/speech, spec 03): record, analyse, store via
  `completeTest`, with the stage and a spoken-style retry hint read from `useSpeechProgress`. Not yet verified on a
  real microphone. The waveform still reads `lib/media/micLevel` (the consent-time analyser), not the runner's own
  level, so it works even before a run starts.
- **Second-opinion consent checkbox** is not built (no frame capture exists either). When built it must be a separate, UNCHECKED-by-default checkbox next to `SECOND_OPINION_CONSENT_TEXT` (`lib/privacy/consentText.ts`: free Gemini tier, Google may use content, human reviewers may read it), and nothing is sent unless ticked.

## Privacy, consent and clearing data
Designed to minimize data; the app makes no compliance claims ("HIPAA compliant", "fully private" are banned wording, pinned by `privacy/consent.test.ts`). Copy lives in `lib/privacy/consentText.ts` and must stay true to the data flow.
- **Consent before capture.** The home panel (`PermissionsCard`) lists what happens to video, the speech clip, the voice guide, the alert text and stored data, then an unchecked-by-default checkbox (`store.consented`). Until it is ticked: "Start the test" is disabled and `beginTests()` is a no-op, the permission buttons do nothing, `useMediaPipe` does not acquire the camera, and `openBrowserMic` refuses. Unticking withdraws and calls `clearAllLocalData()`. Consent is memory-only (every page load starts unconsented) and survives `reset()` ("Run the check again") but not `clearAll()`.
- **Voice guide is a separate opt-in** (`store.voiceConsent`), asked at the point of use: "Start guide" opens a short disclosure (streams mic audio to ElevenLabs) with "Allow and start" / "Not now". `useAgent.start()` also refuses without it, so nothing contacts `/api/agent/signed-url` or ElevenLabs first. It resets whenever the session disconnects (End guide, dropped socket, Clear my data).
- **Location** has its own "Allow" button per row and can be skipped; it only goes into the alert text.
- **Clear my data** (`ClearDataButton` on the consent panel and the result screen) and the header logo both run `lib/privacy/clearData.ts`: cancel running checks and the speech recording, hang up the voice guide (bounded 1.5 s wait), stop the mic stream and camera tracks, empty the calibration-tool stores (WAV blobs, typed subject), `clearAll()` the session (results, transcript, opinions, location, patient info, permissions state, consent), then `localStorage.clear()`, `sessionStorage.clear()` and delete every IndexedDB database. Each step is independent; failures are reported, never fatal. Browser-level camera/mic/location grants belong to the browser and can only be reset from the address bar (the UI says so).
- **What is stored in the browser today:** nothing in normal use. Only the `?record=` calibration tools write `strokeshield.record.subject` / `.conditions` to localStorage and trigger file downloads; both panels are mounted only when that query param is present and now warn that files stay on the device and to use an anonymous id. No PII (name, location) is put in URLs or logs; `console.debug` calls log error objects and tags only.
- **No third-party tracking.** No analytics, and fonts (`@fontsource-variable/*`), MediaPipe wasm and models are self-hosted. One exception found: the ElevenLabs SDK loads its `libsamplerate` audio worklet from `cdn.jsdelivr.net` when the browser cannot honour a 16 kHz `AudioContext` (Safari/Firefox, or a mismatched sample rate); Chrome does not. `frontend/vercel.json` allows only that exact file. Follow-up: self-host it (SDK option `libsampleratePath`).
- **Headers** (`frontend/vercel.json`): CSP (`self`, `wasm-unsafe-eval` for MediaPipe, `blob:` for workers/worklets, `api.elevenlabs.io` https+wss, `*.up.railway.app` for the backend), `Permissions-Policy` camera/microphone/geolocation = self (geolocation is needed by the alert's location fix), no-referrer, nosniff, frame denial, HSTS. Vercel cannot template `VITE_API_BASE_URL` into headers: narrow the Railway wildcard to the real backend origin once known. Not verified in a live browser.
