# 00 — Overview, Scope & Decisions

## One-liner
StrokeShield is only a tool to help guide someone through the **BE-FAST** stroke check using their webcam and mic, narrated by a voice assistant.
If a combined heuristic score crosses a threshold it counts down and texts a demo number. It is not clinically accurate, not a medical device, and cannot diagnose or rule out a stroke.

## Users & scenario
Someone alone (or a bystander) suspects a stroke. They open the site, consent to camera/mic/location, and the assistant guides them:
smile → raise arms → repeat a sentence → verdict. If risk is high (or they ask), the system counts down 10 s and texts for help.

## Scope (36–48 h, live demo)
**MVP (must ship)**
- Guided FAST session: Face → Arms → Speech → verdict.
- In-browser MediaPipe face + pose analysis with live overlay.
- Speech analysis with advanced heuristics (Python DSP; optional PyTorch phoneme scoring). A transcript step (ElevenLabs Scribe) is a pluggable interface only: **no transcriber is implemented**, so intelligibility comes from phoneme scoring when enabled.
- ElevenLabs Agent with client tools; user can say "call 911 / call for help" at any time.
- Weighted risk score with threshold; 10 s cancelable countdown; a text to the demo phone (email-to-SMS via the carrier gateway; Twilio is the legacy option).
- Location (browser geolocation) → Google Maps link in the alert text (there is no phone call).
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
| Honest claims | One shared disclaimer (`lib/disclaimer.ts`) everywhere; no "detect/screen/diagnose", no all-clear, low band neutral and says it cannot rule out a stroke; info-page stats labelled as published research; "AI second opinion" wording dropped | Owner: the site is only a BE-FAST guide with no clinical accuracy; a reassuring result could delay care |
| Privacy | Explicit unchecked-by-default consent before any capture; voice guide and (future) second opinion are separate opt-ins; "Clear my data" wipes memory and browser storage; CSP via `frontend/vercel.json`; wording is "designed to minimize data", never a compliance claim | Owner wants the app very privacy-compliant; details in spec 06 "Privacy" |
| Stack | Vite+React+TS frontend, FastAPI backend | Matches existing scaffold; Python gives us librosa/Parselmouth for speech DSP |
| Vision | Hybrid: in-browser MediaPipe (real time) + Gemini vision second opinion on still frames (free tier) | Real-time + no video upload for the core path; second opinion adds robustness. Gemini, not Claude: the event allows only free/public APIs and Gemini has a free tier |
| Speech | Fixed-phrase repetition; acoustic/temporal DSP heuristics (+ optional phoneme scoring). Scribe transcript was planned but is NOT implemented | Most explainable, best accuracy achievable without training data |
| Voice agent | ElevenLabs conversational agent + client tools; app state machine is source of truth | Natural conversation and interruptions, deterministic flow |
| Trigger | Weighted risk score (noisy-OR) with threshold, plus explicit user request | Explainable dashboard, tunable |
| Session | Guided FAST session | Predictable demo |
| Messaging | **Email-to-SMS** (Verizon `vtext.com` gateway over Gmail SMTP), demo number only; Twilio kept as a legacy `ALERT_CHANNEL` | Twilio trial numbers are blocked by US carriers (error 30034) and registering needs a paid account, which the event rules forbid; the gateway is free. Best-effort, no receipt. Owner approved changing the "SMS via Twilio" rule on 2026-09-19 |
| Hosting | Frontend Vercel; backend **Railway** (Dockerfile/nixpacks, no free-tier cold starts); local as demo fallback | HTTPS for camera/mic; Render free tier sleeps, Fly needs more setup |
| Trained models | No custom-trained classifiers (no suitable stroke data in 36-48h). TensorFlow adds nothing: MediaPipe is already TFLite. Pretrained wav2vec2 (PyTorch) only as a speech stretch | Explainable heuristics beat an unvalidated model; pretrained phoneme scoring needs no patient data |
| Eyes / phonemes | Both are post-MVP stretches, flag-gated, off by default | Ship FAST first; keep the demo path safe |
| Privacy defaults (backend) | Gemini second opinion is **off unless `SECOND_OPINION=true`**; no persistence, no PII in logs; `no-store` + security headers, body caps and per-IP rate limits on the API (spec 01 "Privacy & abuse hardening") | Free-tier Gemini may train on / human-review submitted content and forbids personal information; the app handles face images and voice. ElevenLabs STT zero-retention (`enable_logging=false`) is enterprise-only, so it is NOT used |
| Heavy-model hosting | Run backend on the demo laptop; Railway is the backup (feature flags off, no torch) | No image-size/memory limits; localhost needs no HTTPS |
| Agent tooling | Claude Code + Codex/Gemini → `AGENTS.md` canonical | Shared spec |
| Test order | **Eyes → Face → Arms → Speech** (`testSequence()`); speech moved to last at the project lead's request (was first, per the storyboard) | The patient steps back for arms then returns close for speech (the speech screen says so); the mic still needs to be near for the recording. Arms is no longer last |
| Eyes test | **Promoted out of stretch and turned ON** (`FEATURES.eyesTest = true`), wired end to end | Storyboard includes it; the analyzer and stimulus were already built and tested. Still unverified live — flip the flag off if it misbehaves on demo day |
| Result bands | Three UI bands (`high` / `caution` / `low`) via `resultBand()`; the alert trigger stays the single `RISK_THRESHOLD` | The storyboard wants a "somewhat concerning" screen that offers self-help without raising an alarm |
| Visual direction | Light clinical chrome, one deep-blue accent, red reserved for emergency, dark camera stage, no gradients | Reads as a medical instrument rather than a consumer app; the dark stage makes the viewfinder unmistakable |
| Typography | **Tiempos** (titles) + **Avenir** (everything else), per the design brief. Both are commercial, so the CSS stacks lead with the real fonts and fall back to bundled **Newsreader** / **Nunito Sans** (`@fontsource-variable/*`, self-hosted, no CDN). Replaces the earlier Geist + Geist Mono choice | Brief asked for it. Avenir is on macOS/iOS already; Tiempos needs licensed files added under `public/fonts/` for the deployed site (see spec 06) |
| Speech robustness | Conservative scoring for unknown voices/rooms/mics: QUALITY signals (phoneme model, jitter/shimmer) are capped at 0.20 unless a TIMING signal (rate, pausing, prosody) agrees; a lone timing signal is capped 0.20-0.40; a noisy room (SNR < 15 dB) caps at 0.35 and dents confidence; a different sentence or background voices are a specific retry, not a severity. Costs sensitivity for a speaker whose ONLY sign is mis-articulation | The biggest demo risk is a healthy judge being flagged; on TTS variants of a healthy sentence the phoneme+voice-quality pair alone reached 0.45-0.75. Details: spec 03 "Robustness" |

## Assumptions (change if wrong)
- One patient, one webcam, decent lighting, upper body visible from ~1–1.5 m.
- English only. Desktop Chrome for the demo.
- Time "T" in FAST = last-known-well time, asked by the agent and included in the alert.
- Team has accounts/keys for ElevenLabs, Gemini (optional) and a Gmail app password for email-to-SMS (Twilio only if using the legacy channel).

## Open items (owner: whoever answers first, record answer here)
- [x] Twilio was abandoned as the alert channel (trial numbers are blocked by US carriers; registration is paid). `DEMO_PHONE_NUMBER` = the demo-runner's phone (local `.env`, not committed).
- [ ] Send one real email-to-SMS test with `python scripts/sms_check.py --send` (`DRY_RUN=false`) and note trigger-to-receipt time.
- [x] Backend host: **Railway** (fallback: run locally).
- [ ] Gemini free-tier + ElevenLabs credit/plan limits (agent minutes, Scribe usage).
- [x] Live-demo patient: the project lead. [ ] Fallback teammate if lighting/camera fails: TBD.

## Safety & ethics (state these in the pitch and UI)
- **One disclaimer everywhere** (`frontend/src/lib/disclaimer.ts`, shown on home, consent, every result band, info page, test screens and a footer): only a guide through BE-FAST, not clinically accurate, not a medical device, cannot diagnose or rule out a stroke, call 911. Never pitch it as detecting, screening for, or diagnosing stroke, and never quote the info-page statistics (neurons, treatment windows, BE-FAST vs FAST) as this app's performance: they are from published papers. Nothing is validated; thresholds are uncalibrated.
- Not a medical device; does not replace calling emergency services. UI always shows a manual "Call 911" `tel:` button.
- Full data map, vendor terms, compliance posture and known gaps: [docs/PRIVACY.md](../PRIVACY.md) (designed to minimize data; not certified compliant).
- Video is processed in the browser and never stored. Only optional still frames (with consent) go to the vision second opinion; audio clip goes to the backend for analysis and is not persisted.
- Demo only texts the team's number (no phone call is ever placed). False positives/negatives are expected; thresholds are uncalibrated heuristics.
