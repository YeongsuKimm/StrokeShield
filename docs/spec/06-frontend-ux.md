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
  hero and "Start the check". One quiet line of small text under the button says what happens next (`homeStepsHint`, ~12 words, no card or icon; `lib/copy/features.ts`). Sustained downward input opens the info document and **commits** (no half-scrolled state). The gesture lives in
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
- `reset()` (logo, "Run the check again", info-page "Start the check", demo reset) clears the session but keeps
  browser facts: `permissions` and `agentConnected`. Alert actions are phase-guarded: `cancelCountdown` /
  `confirmCountdown` only act during `countdown`, `setAlertResult` only during `alerting` (a response arriving after a
  reset is dropped), and `requestEmergency` is ignored while an alert is in flight (no double SMS). After a FAILED alert `retryAlert()` (one-shot) re-sends without a countdown; the send itself lives in `lib/alertFlow.ts`, failure wording in `lib/alertFailure.ts` (spec 05).
- The speech screen starts recording only from the user's **Start recording** button. The voice agent waits for that
  result and cannot start the microphone through its client tool.
- **Info** (`InfoPage`): process (BE-FAST), why, stats (digits roll up from zero via `ui/SlotNumber` when scrolled into view), Q&A + hotlines, team (names + Johns Hopkins University). The header logo resets the session and returns home. Reached from the header menu too. The stats section ends with a "Where to learn more" block of verified links (education pages, then the papers behind each figure, by DOI); every link is checked before it is added.
- **Header menu** (`chrome/SiteHeader` + `ui/DrilldownMenu` + `chrome/menuTree.ts`): a drilldown list. Collapsed it shows
  ONE row, "Learn more" ("Sections" on the info page); opening it reveals the sections, and "The process" (Speech, Eyes,
  Face, Arms, Time) and "Questions & hotlines" (Hotlines, Common questions) drill one level deeper. The clicked row
  stays put and greys into a breadcrumb; click it to step back. Leaves jump to an element id on the info page, so
  every target needs an id there (`process`, `step-*`, `why`, `stats`, `help`, `hotlines`, `faq`, `team`). The logo
  returns to the idle homepage from any phase. Collapses on
  Escape, outside click and after a choice. The component is adapted from **Drilldown Menu by ruixen.ui on 21st.dev**
  (retrieved with `npx @21st-dev/cli get`, not `add`: the CLI's install path runs `shadcn add`, which would init shadcn
  and rewrite `index.css`). New dependency: `framer-motion` (~+159 kB gzipped on the main bundle).
- **Result** (`ResultScreen`): banner in one of three bands, three actions (call 911 / alert a contact / ER nearby). In
  demo mode, the contact action explicitly says it sends regardless of the result and whether the permitted location
  fix will be included; it still uses the normal cancel countdown, rate limit and backend-only `DEMO_PHONE_NUMBER`,
  alert status with dry-run badge, and the risk dashboard underneath.
- **Risk dashboard** (`Dashboard`): per-test card (severity bar, confidence, max weight, flags, raw metrics in an
  expandable table), combined risk gauge with threshold marker, and the per-test noisy-OR arithmetic. Judge-facing.
- **Countdown modal**: ring, reason line, big "Cancel the text" (autofocused, Escape also cancels; `<main>` is `inert`
  behind it; the voice-cancel hint shows only while the agent is connected), and a direct
  `tel:911` link. Copy says "emergency contact", never "911", because the backend only ever texts `DEMO_PHONE_NUMBER`.
  **Alert preview:** under the 911 link (never above Cancel), `AlertPreview` shows the exact text ("This is the text that will be sent"), built by `lib/alertPreview.ts::buildShortMessage`, a mirror of `services/email_sms_service.py::build_short_message` pinned by the shared golden vectors `tests/fixtures/alert_message_vectors.json` (pytest and vitest read the same file; change the Python builder, the vectors and the TS mirror together). It adds "Delivery is best effort." when `/api/health` says live, "Demo mode: nothing will be sent." when it says dry-run, and neither line if health is unreachable; it never blocks or delays the countdown, and renders nothing if the text cannot be built. The result screen shows the text actually sent (`sentText`, memory only) after a send, or the failed one. The modal scrolls on short screens.
- Persistent floating "Call 911" (`tel:`) on every screen, every phase.

### Result screen extras (all in memory, nothing stored or sent)
- **Copy summary** (small quiet button in the action row, `CopySummary`): `lib/summary.ts::buildSummary` writes date/time, checks completed and skipped, each check's plain flags, the result band in the SAME words as the screen (`RESULT_BAND_COPY`, never "all clear"), last known well if given, the short disclaimer and "Call 911 if you think this is a stroke." It leaves out location, names, scores and raw metrics. Clipboard API, then a hidden-textarea `execCommand`, then a selected read-only text area; "Summary copied" goes to a polite `role="status"`.
- **The numbers behind each check** (`MeasuredPanel`, a collapsed `<details>` above the dashboard): `lib/measured.ts` turns the analyzers' metrics into plain rows (mouth-corner lift left vs right, each arm's lowest angle and drift, gaze range to each side, speaking rate / pauses / recording clarity), each check labelled "Measured, not a diagnosis."; skipped, unclear or missing checks say "Not measured." Patient-left/right throughout; numbers only, no video or frame replay.

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
  Their screen-reader descriptions follow the current locale. Camera startup, permission, device, model-load and
  mid-check failure messages are translated on the Spanish route rather than exposing runtime English.
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
  **Eyes check:** after the second failure the screen also shows the specific reason + tips and a **Continue without this check** button next to Try again (immediately, not after the 15 s hatch); it skips the eye test (dropped from the score, never guessed). Details: spec 02 "Eyes: outcomes, tolerances and never a dead end".
- Large tap targets, high contrast, accessible captions (patient may be impaired). Visible focus rings everywhere,
  including on the dark stage.
- No blocking spinners > 3 s without status text.
- The mute warning only fires for a microphone we actually hold (`evaluateMic`), never as a guess.

## Accessibility (target WCAG 2.2 AA)
Audience: people who may be having a stroke, older adults, screen-reader, keyboard and low-vision users. Verified by code
reading, unit tests and lint only; a real screen reader and browser pass is still needed (see STATUS).
- **Keyboard:** whole flow is operable without a mouse. Tab order is skip link, **Call 911**, header, page. While the
  countdown dialog is open everything else is `inert`, focus starts on **Cancel the text** (Enter/Space cancels), Escape also
  cancels, and its own **call 911** link is next. Consent prompt of the voice guide closes on Escape and returns focus.
- **Focus + titles:** each screen's heading (`h1`, `tabIndex=-1`) takes focus when the screen appears (not on the first
  page load), via `useFocusHeading`; the result screen re-focuses when the phase moves on (`lib/a11y/useA11y.ts`).
  `document.title` is unique per route/phase (`lib/a11y/pageTitle.ts`).
- **Live regions (never spam):** test heading + lede are one polite region (instruction changes). The camera stage has ONE
  sr-only polite region fed through `createAnnouncer` (max one change per 3 s): intro / get-ready caption, framing hint,
  and capture seconds only on 5 s marks (`captureAnnouncement`). The 3-2-1 digits, ring, guides, canvas, video and eye dot are
  `aria-hidden`; the guides keep a text alternative. The emergency countdown speaks at the start, every 5 s and at 3, 2, 1
  (`countdownAnnouncement`). Retry/permission errors use `role="alert"`. The transcript is a keyboard-scrollable `role="log"`;
  everything the voice agent says is also on screen there.
- **Structure:** document `lang` follows the selected locale (`en` or `es`), header/nav/main/footer landmarks, one `h1` per screen (the info page has an sr-only one),
  progress is an `ol` with state in words (done / you are here / skipped / still to do) and different shapes, not colour only.
- **Contrast:** every token pair is checked by `lib/a11y/contrast.test.ts`, which reads `index.css`. Muted ink `--color-ink-3`
  was darkened to 5.0:1 on the sunken well; `--color-control-edge` (>= 3:1) borders quiet buttons and the consent checkbox;
  `--color-ok-stage` is the green used on the dark camera stage. `prefers-contrast: more` darkens muted text and hairlines;
  `forced-colors` gets a system focus ring and border/fill fallbacks for dots and meters.
- **Motion:** CSS animations/transitions are cut by `prefers-reduced-motion`; framer-motion and the slot numbers also check it.
- **Targets and reflow:** primary actions are >= 44 px (Allow buttons, voice guide buttons, brand); nothing uses fixed px
  heights for text (all rem). Header brand shrinks on 320 px phones.

## Phones (Safari and Chrome, portrait)
The whole check is done in **portrait**; there is no "turn your phone sideways" step. See [../MOBILE-TEST.md](../MOBILE-TEST.md)
for how to get the site onto a device and what is still unverified there.
- **Camera.** Phones are asked for a **portrait 3:4** stream at 24 fps (`cameraConstraints`, useMediaPipe.ts). 3:4 is
  the widest view a phone gives in portrait, which is what the arm check needs: the patient's whole arm span has to fit
  ACROSS the frame, and a 16:9 stream rotated into portrait (9:16) is far too narrow to pass the framing gate at any
  sensible distance in a room. Everything downstream reads the real `videoWidth / videoHeight`, so a portrait stream is
  measured correctly with no other change. Desktop is untouched at 16:9.
- **Arm distance.** No distance is quoted anywhere any more (screen, voice agent, or prompt docs): how far back is far
  enough depends on the camera, and the framing gate already measures the real thing. The screen tells the patient to
  keep moving until the outline turns green and tells phone users to stand the device up first.
- **The camera stage may not grow under the floating controls.** `--cam-max-h` (index.css) caps it below `sm`; the cap
  is applied as a MAX-WIDTH derived from the real aspect, because capping height would stretch the video and misalign
  the landmark overlay. Call 911 and the voice guide sit bottom-left and bottom-right, exactly where the hands are.
- **Prompts over the camera are compact for the close-up checks.** Eyes and face are done near the screen, so their
  pill, caption bar and intro card use small type and padding (`compact` in CameraView); the arms check keeps large
  ones because the patient reads it from several feet away. The top of the stage is one stacked column ("SMILE!", then
  the hint), so the two can never overlap, and nothing may sit on the eye-test dot's row. The dot is clamped inside its box.
- **Check screens fit without scrolling.** The lede is hidden below `sm` (the same instruction is already on the camera
  in much larger type) and the header is tighter.
- **Safe areas.** The page draws edge to edge (`viewport-fit=cover`); every fixed bottom control adds `var(--safe-b)`
  so it clears the iPhone home bar. `overscroll-behavior-y: contain` stops Android's pull-to-refresh reloading the page
  and losing the session mid-check.
- **Demo controls.** On phones the optional demo panel sits above the voice-guide control instead of occupying the same
  bottom-right position. Its body scrolls within the viewport on short screens, so the one-click healthy/stroke paths
  and reset action remain reachable. Launching a scenario or countdown collapses the panel so it cannot cover the
  result or emergency countdown.
- **Touch.** 44 px minimum tap target; the drilldown menu scales its whole em grid up on a coarse pointer.
- **Unsupported browsers** (`browserSupport.ts`, pure + tested). In-app web views (Instagram, TikTok, a chat app) block
  camera access, so they get a red "open this in Safari or Chrome" banner. Anything that is not WebKit or Blink gets one
  quiet, dismissible "not tested" line and is never blocked: telling someone who may be having a stroke that their
  browser is unsupported, and stopping there, would be the worst outcome available.
- **`pnpm test:mobile`** is a phone-layout regression check (overflow, controls over the camera, tap targets). It needs
  a dev server and is deliberately NOT part of `pnpm test`, so CI stays on vitest.
- **Lint:** oxlint runs the `jsx-a11y` plugin (`.oxlintrc.json`); `prefer-tag-over-role` is off on purpose.
- **Not changed on purpose:** the emergency countdown is the only timed step; everything else has no time limit. Scroll-to-info
  hand-off (wheel) is a shortcut only; the "How it works" button is always there.

## Localization
- English is served at `/`; Spanish is served at `/es`. `lib/i18n.ts` owns the locale, exact speech phrases and shared runtime-caption translations. The persistent `EN` / `ES` header control updates the path and document language without resetting the check.
- Both locales use the same components, state machine, analyzers and safety behavior. Localized surfaces include consent and permissions, the four checks, camera cues and retry actions, transcript chrome, countdown/results, emergency actions, disclaimers, and the methods/resources document. Developer-only demo, calibration and preflight panels remain English.
- `api.signedUrl(locale)` selects the separate ElevenLabs agent. Changing locale ends a connected guide and withdraws its voice opt-in, preventing the old-language agent from continuing. `api.analyzeSpeech` posts the locale and exact locale-specific target phrase; Spanish scoring behavior is in spec 03.
- Vercel rewrites a direct `/es` request to the SPA entry point. Locale is not stored; refresh derives it from the URL. The backend's alert body remains English, and the Spanish preview labels that fact.
- Spanish copy was AI-written and still needs review by a native speaker, especially emergency wording and consistent formality. Localization does not change analyzer thresholds.

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

## Resilience (flaky wifi, no white screen, no dead end)
Code: `frontend/src/lib/resilience/*`, `lib/preflight/*`, `lib/demo/scenarios.ts`, `components/ErrorBoundary.tsx`, `LazyBoundary.tsx`, `PreflightPanel.tsx`, `chrome/StatusBanners.tsx`. All pure logic is unit-tested (fuzz, leak, api, preflight, lifecycle).
- **Crash screen.** A root `ErrorBoundary` (`main.tsx`) catches render errors, switches the camera and microphone off and offers Reload / Start over / Clear my data plus a plain `tel:911` link; it uses no store or icons, so it cannot fail for the same reason. `error` / `unhandledrejection` handlers only log (name + short message with digits, emails and query strings blanked; never a stack, payload, transcript or location) and keep the last 8 in memory. Lazy pieces (info page, dashboard, voice guide, preflight) sit in a `LazyBoundary`: a failed download shows "could not load, Try again / Reload" for that piece only and never touches a running check.
- **Network.** Every call in `lib/api.ts` has a timeout (health 4 s, signed URL 6 s, alert 20 s, speech 25 s, second opinion 8 s) and fails with a typed `ApiError` (`offline` / `timeout` / `network` / `rate-limited` / `server` / `client` / `malformed`) carrying a plain sentence. Only read-style calls retry (signed URL once); the **alert is never retried**, so a lost response cannot become a second text. `useNetwork` (`navigator.onLine` plus "two connectivity failures in a row") drives a banner saying the camera checks still work and 911 is the fallback. Speech failures say wifi vs slow server and point at Skip. The vision checks never call the backend.
- **A failed alert is loud.** One implementation: main's `lib/alertFlow.ts` + `alertFailure.ts` + `components/result/AlertStatus.tsx` (categories, Call 911 first, one-shot retry, 120 s lock). Typed `ApiError`s (`kind`, `status`, `retryAfterS`) feed `failureFromError`, so offline and timeout say so; the alert request itself is never auto-retried.
- **Session invariants** (`session/fuzz.test.ts`, 36 000 random steps): results only for the four known tests with finite numbers; a test screen is never a skipped/finished test; alert status lives and dies with its phase; `alerting` only from `countdown`, `alerted` only from `alerting`; every phase has an exit; `reset()` always returns a clean idle (consent kept). Store fixes the fuzz found: a late result or skip during the countdown/alert no longer steals the screen; `start`/`beginTests`/`acceptConsent` cannot pull the screen off a countdown or in-flight alert; `beginTests`/`start` begin with a clean run; a fresh emergency request clears the previous attempt's outcome; `setAlertResult` only accepts `sent`/`failed`; `goHome` is a full reset.
- **Lifecycle** (`lifecycle.ts`). Tab hidden mid-check: run cancelled (nothing half-captured is stored), camera off, "Paused while this tab was in the background" notice; visible again: camera checks restart automatically, speech waits for the patient to press Start recording. The countdown and alert are never paused. `pagehide` / `beforeunload` stop camera and microphone. Screen Wake Lock is held during checks, countdown and alert (best effort, released after, re-acquired on visible). Resize / orientation is handled by `CameraView`'s `ResizeObserver` and `100dvh` layout.
- **Bundle.** The app shell was one 1,113 kB chunk; now 519 kB (167 kB gzip, after merging main's a11y work). Lazy chunks: voice guide + ElevenLabs SDK 594 kB, MediaPipe runtime 154 kB (already dynamic, loaded when the first camera check starts), info page 9 kB, dashboard 5 kB, preflight 9 kB. After consent the MediaPipe runtime, both models and the SIMD wasm are prefetched (skipped on Save-Data). `chunkSizeWarningLimit` is 650 because the lazy voice chunk is third-party. framer-motion stays in the shell.
- **Preflight** (`?preflight=1` or the footer link "Demo preflight"): green/amber/red rows with a one-line fix for secure context, browser support (getUserMedia, AudioWorklet, WebGL, WebAssembly), `/api/health` (shows `dryRun` and `demoMode`; **live texts armed is amber**), camera and microphone (permission query + device count, no stream opened), MediaPipe models + WASM (loads and closes both, reports GPU vs CPU), and the voice guide (`api.signedUrl()` only; the link is never displayed). Nothing captured or stored. The health contract is unchanged.
- **Demo mode** keeps working with no consent, no camera and no backend: `lib/demo/scenarios.ts` (used by the DemoPanel) reaches the low, caution and high bands and the countdown, tested in `demo/scenarios.test.ts`.
- **Needs a real browser** (not verifiable here): hidden-tab pause/resume with a live camera, wake lock, the crash screen and the offline banner visually, preflight on real hardware (GPU vs CPU), lazy-chunk retry with wifi cut.

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

## Honest disclaimer (no clinical claims)
One constant, `lib/disclaimer.ts` (`DISCLAIMER_SHORT`, `DISCLAIMER_LONG`), rendered by `components/ui/Disclaimer.tsx`: only a guide through the BE-FAST check, not clinically accurate, not a medical device, cannot diagnose or rule out a stroke, call 911. It appears on the home page, first in the consent list (`CONSENT_POINTS[0]`), in the result banner (all three bands), the info page (top), every test screen and a footer under every route. The low band is neutral (not green) and says the checks cannot rule out a stroke; the info page's numbers are labelled "published research, not results from StrokeShield". `lib/disclaimer.test.ts` pins the usage and bans phrases such as "all clear", "you are fine", "clinically accurate" (unless negated), "second opinion", "HIPAA compliant". Countdown cancel reads "Cancel the text" (not "I am OK"). Analyzer flags like "smile looks symmetric" still appear on the dashboard; they describe a measurement, not a finding.

## Privacy, consent and clearing data
Designed to minimize data; the app makes no compliance claims ("HIPAA compliant", "fully private" are banned wording, pinned by `privacy/consent.test.ts`). Copy lives in `lib/privacy/consentText.ts` and must stay true to the data flow.
- **Consent before capture.** The home panel (`PermissionsCard`) lists what happens to video, the speech clip, the voice guide, the alert text and stored data, then an unchecked-by-default checkbox (`store.consented`). Until it is ticked: "Start the check" is disabled and `beginTests()` is a no-op, the permission buttons do nothing, `useMediaPipe` does not acquire the camera, and `openBrowserMic` refuses. Unticking withdraws and calls `clearAllLocalData()`. Consent is memory-only (every page load starts unconsented) and survives `reset()` ("Run the check again") but not `clearAll()`.
- **Voice guide is a separate opt-in** (`store.voiceConsent`), asked at the point of use: "Start guide" opens a short disclosure (streams mic audio to ElevenLabs) with "Allow and start" / "Not now". `useAgent.start()` also refuses without it, so nothing contacts `/api/agent/signed-url` or ElevenLabs first. It resets whenever the session disconnects (End guide, dropped socket, Clear my data).
- **Location** has its own "Allow" button per row and can be skipped; it only goes into the alert text.
- **Permission prompts** (`lib/media/permissions.ts`, `PermissionsCard`): each of camera / microphone / location is requested only from its own button (or "Allow all", sequential) AFTER the consent tick, never on load (page load only *queries* state and watches `change`). Every request resolves (never throws or hangs: a 45 s cap covers a prompt nobody answers) to `{state, problem}`: `denied` -> lock-icon instructions; `dismissed` (closed with the X, Chrome state still `prompt`) -> "press again"; `no-device` / `busy` (NotFound/Overconstrained, NotReadable) -> plug in / close the other app, state left as-is; `insecure` (not HTTPS/localhost) -> one banner, buttons disabled. Every failed row keeps a **Try again** button, so nothing is stranded; Start never requires a permission, camera denial at test time shows "Try the camera again" plus the skip hatch, and a camera track that ends mid-test (revoked/unplugged) flips the engine to that same error state. A stream that arrives after consent was withdrawn, or after the 45 s cap, is stopped. The mic stream from the card is kept for the mute meter only (analyser, never played or recorded); the speech test and the voice guide open their own streams (no second prompt once granted); `clearAllLocalData` releases all of it. A voice-guide start failure now shows an actionable message instead of failing silently.
- **Location details:** consent-time fix = high accuracy, 10 s browser timeout (+ 45 s cap for the prompt), `maximumAge` 30 s, one coarse retry on timeout/unavailable (5 min age); POSITION_UNAVAILABLE/TIMEOUT mean "allowed, no fix" (not "Blocked"). At alert time `locationForAlert` NEVER prompts and waits at most 3.25 s: if the browser already says `granted` it refreshes (`maximumAge` 2 min), else it uses the cached fix; a location revoked since is dropped; without the consent tick nothing is read. Every fix is validated (finite, lat -90..90, lng -180..180, else dropped so the backend cannot 422 the alert) and rounded to 5 decimals (~1 m) with whole-metre accuracy before it is stored or sent; it appears only in the alert body (never in a URL, console or storage).
- **Clear my data** (`ClearDataButton` on the consent panel and the result screen) and the header logo both run `lib/privacy/clearData.ts`: cancel running checks and the speech recording, hang up the voice guide (bounded 1.5 s wait), stop the mic stream and camera tracks, empty the calibration-tool stores (WAV blobs, typed subject), `clearAll()` the session (results, transcript, opinions, location, patient info, permissions state, consent), then `localStorage.clear()`, `sessionStorage.clear()` and delete every IndexedDB database. Each step is independent; failures are reported, never fatal. Browser-level camera/mic/location grants belong to the browser and can only be reset from the address bar (the UI says so).
- **What is stored in the browser today:** nothing in normal use. Only the `?record=` calibration tools write `strokeshield.record.subject` / `.conditions` to localStorage and trigger file downloads; both panels are mounted only when that query param is present and now warn that files stay on the device and to use an anonymous id. No PII (name, location) is put in URLs or logs; `console.debug` calls log error objects and tags only.
- **No third-party tracking.** No analytics, and fonts (`@fontsource-variable/*`), MediaPipe wasm and models are self-hosted. One exception found: the ElevenLabs SDK loads its `libsamplerate` audio worklet from `cdn.jsdelivr.net` when the browser cannot honour a 16 kHz `AudioContext` (Safari/Firefox, or a mismatched sample rate); Chrome does not. `frontend/vercel.json` allows only that exact file. Follow-up: self-host it (SDK option `libsampleratePath`).
- **Headers** (`frontend/vercel.json`): CSP (`self`, `wasm-unsafe-eval` for MediaPipe, `blob:` for workers/worklets, `api.elevenlabs.io` https+wss, `*.up.railway.app` for the backend), `Permissions-Policy` camera/microphone/geolocation = self (geolocation is needed by the alert's location fix), no-referrer, nosniff, frame denial, HSTS. Vercel cannot template `VITE_API_BASE_URL` into headers: narrow the Railway wildcard to the real backend origin once known. Not verified in a live browser.
