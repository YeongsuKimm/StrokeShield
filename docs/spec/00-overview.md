# 00 — Overview, Scope & Decisions

## One-liner
StrokeShield walks a possible stroke patient through the **FAST** test using their webcam and mic, guided by a voice assistant,
and automatically calls for help when the combined risk score crosses a threshold.

## Users & scenario
Someone alone (or a bystander) suspects a stroke. They open the site, consent to camera/mic/location, and the assistant guides them:
smile → raise arms → repeat a sentence → verdict. If risk is high (or they ask), the system counts down 10 s and texts for help.

## Scope (36–48 h, live demo)
**MVP (must ship)**
- Guided FAST session: Face → Arms → Speech → verdict.
- In-browser MediaPipe face + pose analysis with live overlay.
- Speech analysis with advanced heuristics (Python DSP + ElevenLabs Scribe transcript).
- ElevenLabs Agent with client tools; user can say "call 911 / call for help" at any time.
- Weighted risk score with threshold; 10 s cancelable countdown; Twilio SMS to `DEMO_PHONE_NUMBER`.
- Location (browser geolocation) → Google Maps link in SMS and spoken on the call.
- Live risk dashboard showing per-test metrics and score breakdown.
- Demo/simulation mode (force results without acting symptomatic).

**Stretch (only after MVP is demo-stable)**
- ~~**Eyes test (BE-FAST)**~~ — promoted into the MVP and wired (see the decisions log); unverified on a live camera.
- **Phoneme-level speech scoring**: wav2vec2 phoneme recognizer + Goodness-of-Pronunciation, behind `PHONEME_SCORING` (spec 03).
- Gemini vision second-opinion signal folded into the face/arm scores.
- Passive continuous monitoring.
- Caregiver contacts; multilingual agent.

**Out of scope:** real 911 dialing, accounts/auth, persistence of video/audio, clinical validity claims.

## Decisions log
| Decision | Choice | Why |
|---|---|---|
| Stack | Vite+React+TS frontend, FastAPI backend | Matches existing scaffold; Python gives us librosa/Parselmouth for speech DSP |
| Vision | Hybrid: in-browser MediaPipe (real time) + Gemini vision second opinion on still frames (free tier) | Real-time + no video upload for the core path; second opinion adds robustness. Gemini, not Claude: the event allows only free/public APIs and Gemini has a free tier |
| Speech | Fixed-phrase repetition; ElevenLabs Scribe transcript + acoustic/temporal heuristics | Most explainable, best accuracy achievable without training data |
| Voice agent | ElevenLabs conversational agent + client tools; app state machine is source of truth | Natural conversation and interruptions, deterministic flow |
| Trigger | Weighted risk score (noisy-OR) with threshold, plus explicit user request | Explainable dashboard, tunable |
| Session | Guided FAST session | Predictable demo |
| Messaging | Twilio SMS, demo number only | Reliable |
| Hosting | Frontend Vercel; backend **Railway** (Dockerfile/nixpacks, no free-tier cold starts); local as demo fallback | HTTPS for camera/mic; Render free tier sleeps, Fly needs more setup |
| Trained models | No custom-trained classifiers (no suitable stroke data in 36-48h). TensorFlow adds nothing: MediaPipe is already TFLite. Pretrained wav2vec2 (PyTorch) only as a speech stretch | Explainable heuristics beat an unvalidated model; pretrained phoneme scoring needs no patient data |
| Eyes / phonemes | Both are post-MVP stretches, flag-gated, off by default | Ship FAST first; keep the demo path safe |
| Heavy-model hosting | Run backend on the demo laptop; Railway is the backup (feature flags off, no torch) | No image-size/memory limits; localhost needs no HTTPS |
| Agent tooling | Claude Code + Codex/Gemini → `AGENTS.md` canonical | Shared spec |
| Test order | **Eyes → Face → Arms → Speech** (`testSequence()`); speech moved to last at the project lead's request (was first, per the storyboard) | The patient steps back for arms then returns close for speech (the speech screen says so); the mic still needs to be near for the recording. Arms is no longer last |
| Eyes test | **Promoted out of stretch and turned ON** (`FEATURES.eyesTest = true`), wired end to end | Storyboard includes it; the analyzer and stimulus were already built and tested. Still unverified live — flip the flag off if it misbehaves on demo day |
| Result bands | Three UI bands (`high` / `caution` / `low`) via `resultBand()`; the alert trigger stays the single `RISK_THRESHOLD` | The storyboard wants a "somewhat concerning" screen that offers self-help without raising an alarm |
| Visual direction | Light clinical chrome, one deep-blue accent, red reserved for emergency, dark camera stage, no gradients | Reads as a medical instrument rather than a consumer app; the dark stage makes the viewfinder unmistakable |
| Typography | **Tiempos** (titles) + **Avenir** (everything else), per the design brief. Both are commercial, so the CSS stacks lead with the real fonts and fall back to bundled **Newsreader** / **Nunito Sans** (`@fontsource-variable/*`, self-hosted, no CDN). Replaces the earlier Geist + Geist Mono choice | Brief asked for it. Avenir is on macOS/iOS already; Tiempos needs licensed files added under `public/fonts/` for the deployed site (see spec 06) |

## Assumptions (change if wrong)
- One patient, one webcam, decent lighting, upper body visible from ~1–1.5 m.
- English only. Desktop Chrome for the demo.
- Time "T" in FAST = last-known-well time, asked by the agent and included in the alert.
- Team has accounts/keys for Twilio, ElevenLabs, Gemini before hour 4.

## Open items (owner: whoever answers first, record answer here)
- [x] Twilio: **trial account, $15.50 credit** (plenty for the demo SMS). `DEMO_PHONE_NUMBER` = the patient/demo-runner's phone (kept in local `.env`, not committed).
- [ ] **Verify `DEMO_PHONE_NUMBER` in the Twilio console** and confirm the Twilio sender can text it. Test one SMS by hour 4.
- [x] Backend host: **Railway** (fallback: run locally).
- [ ] Gemini free-tier + ElevenLabs credit/plan limits (agent minutes, Scribe usage).
- [x] Live-demo patient: the project lead. [ ] Fallback teammate if lighting/camera fails: TBD.

## Safety & ethics (state these in the pitch and UI)
- Not a medical device; does not replace calling emergency services. UI always shows a manual "Call 911" `tel:` button.
- Video is processed in the browser and never stored. Only optional still frames (with consent) go to the vision second opinion; audio clip goes to the backend for analysis and is not persisted.
- Demo only calls the team's number. False positives/negatives are expected; thresholds are uncalibrated heuristics.
