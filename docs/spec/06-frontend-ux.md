# 06 — Frontend UX, Session State & Demo Mode

Owner: Frontend dev. Files: `frontend/src/**` (except `lib/vision`, `lib/speech`, `lib/risk.ts`).

## Session state machine (Zustand store, single source of truth)
```
idle → speech → [eyes, only if FEATURES.eyesTest] → face → arms → scoring
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
  gesture is only a shortcut). 150 px of wheel travel (`HANDOFF_BUFFER_PX`), a swipe, or ↓/PageDown/End (↑/PageUp/Home
  on info), counted only within 160 px of the relevant page edge. Travel fades slowly (0.97 per 100 ms) so a
  one-notch-a-second mouse wheel still adds up; a lone flick does not fire it; a 700 ms cooldown after each hand-off
  stops trackpad inertia bouncing you straight back. The home direction only listens while `phase === 'idle'`. The
  page itself is never scroll-locked.
- **Test screens** (`TestScreen` + `SpeechTest` / `EyeTest` / `FaceTest` / `ArmsTest`): progress dots, one big
  instruction, the stage, the assistant transcript strip, the mute warning, and the skip hatch.
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
- **Countdown modal**: ring, reason line, big "Cancel — I am OK" (autofocused, Escape also cancels), and a direct
  `tel:911` link. Copy says "emergency contact", never "911", because the backend only ever dials `DEMO_PHONE_NUMBER`.
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
  match the face-width gate) and `BodyGuide` for arms (anchored to frame height), plus two reference figures of the
  arms-out pose.
- **Skip hatch:** after `SKIP_OFFER_MS` (15 s) on any check, a "Skip this check" card appears, **pinned to the bottom-right of the window** (`position: fixed`), so it is
  visible however short the screen while staying clear of the centred controls (Start recording, camera captions) and
  the bottom-left Call 911 button. It is a bordered accent-blue card with a large button and a spring-in entrance,
  and an `aria-live` region so screen readers announce it. On phones it becomes a compact full-width row above the
  Call 911 button, and the page gains bottom padding so controls can scroll clear of it. A skipped test is
  excluded from progression and contributes nothing to the score. A framing gate that never passes can never trap
  the patient.
- Low-confidence result → automatic "let's try that again" (max 1 retry), never a silent pass.
- Large tap targets, high contrast, accessible captions (patient may be impaired). Visible focus rings everywhere,
  including on the dark stage.
- No blocking spinners > 3 s without status text.
- The mute warning only fires for a microphone we actually hold (`evaluateMic`), never as a guess.

## Demo / simulation mode
Enabled with `?demo=1` or `Shift+D`. Shows a floating **Demo Panel**:
- Sliders to override each test's severity/confidence; "Simulate stroke" (face 0.8 + arms 0.7 + speech 0.7) and "Simulate healthy" presets.
- Toggle "Skip live capture" (results come from overrides instantly) and "Trigger countdown now".
- Shows `DRY_RUN` status from `/api/health`; loud red badge when live calls are armed.
- Overrides go through the normal `completeTest` path so scoring, dashboard, agent context, and alert code all run for real.
- Keep the demo panel out of the default UI unless enabled.

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
- **Second-opinion consent checkbox** is not built; `PermissionsCard` covers camera/mic/location only.
