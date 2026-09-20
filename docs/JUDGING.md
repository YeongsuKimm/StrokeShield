# StrokeShield: judge's-eye review

Written as a critical HopHacks judge (engineers, clinicians, entrepreneurs) reading the repo as of 2026-09-19. Blunt on purpose: fix or rehearse the weak spots before a judge finds them.
Honesty rule for everyone presenting: StrokeShield is **only a guide** through BE-FAST. It is **not clinically accurate, not validated, not a medical device, not HIPAA compliant, and cannot diagnose or rule out a stroke.** Never say otherwise on stage, on a slide, or in Q&A.

Contents: [1 Scorecard](#1-scorecard) · [2 Strengths and attack points](#2-strengths-and-attack-points) · [3 Top 12 improvements](#3-top-12-improvements) · [4 Pitch and demo script](#4-pitch-and-demo-script) · [5 Judge Q&A](#5-judge-qa) · [6 Demo-day checklist](#6-demo-day-checklist) · [7 Factual problems found](#7-factual-problems-found)

---

## 1. Scorecard

| Criterion | /10 | Why (honest) |
|---|---|---|
| Impact / problem fit | 7 | Stroke is time-critical and BE-FAST is the real public standard; a bystander guide with "call 911" always on screen is a sensible framing. Docked because a webcam heuristic is not a clinically meaningful screen and the alert goes to a demo number, not a real contact. |
| Innovation / creativity | 6.5 | Browser-only MediaPipe + voice-guided flow + speech DSP + email-to-SMS is a nice integration. Every individual piece is known technique; the eye-tracking-dot and phoneme-scoring touches lift it. |
| Technical difficulty and execution | 8 | Real signal processing (landmarks to severities, DSP features, optional wav2vec2 phoneme scoring), a noisy-OR risk fn, hardened backend (rate limits, dry-run fail-safe, destination-from-env), ~480 frontend + ~280 backend test cases, CI, held-out validation tooling. Unusually mature for a hackathon. |
| Design and UX | 7.5 | Considered visual system (one blue accent, red reserved for emergency, neutral low band that refuses to reassure, skip hatches, retry paths, a11y basics). Risks: many screens and gestures (scroll hand-off, drilldown menu) are polish, not core; the "what the AI saw" story is thin. |
| Completeness / does it work live | 6.5 | The full state machine, bilingual UI/agents, preflight, retry paths and one-click fallback exist. Real speech was exercised on seven acted clips, but left/right mapping, eyes, both live agents, carrier delivery and the intended demo devices still need one rehearsed end-to-end pass. |
| Responsible AI / ethics / safety | 8.5 | Best area: one shared disclaimer, no all-clear, destination locked to one env number, invalid provider values fail closed, DRY_RUN fails safe, consent before capture, minimal data flow, and honest vendor/privacy documentation. Docked for zero clinical validation and unresolved vendor account controls. |
| Presentation readiness | 7.5 | The repo has a readiness panel, rehearsed fallback controls, deployment artifacts and a detailed demo script. Still missing: a backup video, a committed validation report, and recorded proof that the exact demo hardware, agents and live delivery work together. |
| **Overall** | **~6.9** | A strong engineering + ethics story whose weakest point is live reliability and the absence of any validation numbers. Rehearsal, not features, is what moves the score. |

---

## 2. Strengths and attack points

### Lead with
1. **Honesty as a feature.** Neutral "nothing flagged" band that explicitly cannot rule out a stroke; agent forbidden from reassuring; published stats labelled as papers, not app performance. Judges rarely see this.
2. **Runs on the device.** Video never leaves the browser; only a 5 MB-capped speech clip goes to our backend, in memory, discarded. No database, no analytics.
3. **Explainable scoring.** Every result screen shows the noisy-OR arithmetic per test (Dashboard). No black-box model, no fake "AI diagnosis".
4. **Safety engineering.** SMS destination only from `DEMO_PHONE_NUMBER`, DRY_RUN fail-safe (typo stays dry), 10 s cancelable countdown, 1 alert / 2 min, server re-checks risk, always-on `tel:911` button.
5. **Never a dead end.** Every check retries once automatically, then offers Try again and Skip; low-confidence tests are dropped, not guessed.
6. **Evidence tooling** (record, tune, freeze, validate once on held-out people, Wilson bounds) built even though the data is not there yet: a credible path to claims.
7. **Free/public only**, offline models (no CDN on demo day), demo panel that runs the real scoring/alert path with simulated results.

### Weakest points a sharp judge will attack (with the honest answer)
| Attack | Honest answer |
|---|---|
| **"What is the sensitivity/specificity?"** | Unknown. There are no validation reports (`docs/validation/` is empty), thresholds are uncalibrated, and volunteers mimicking a droop are not stroke patients. Say so first. Point to the tooling and the plan (VALIDATION.md). |
| **False positives** | Real risk. The caution threshold was raised to `0.3` so four results at the healthy anchor no longer enter the caution band, and fluent speech now has a conservative demo cap. A single clear face or arm result can still cross the alert trigger by design. Mitigations: confidence gating, 10 s cancel, and a demo-number-only alert. |
| **False negatives** | Worse and undetectable: a clear speech-only deficit (0.45) never alerts; the eyes test can never alert alone (max 0.3); Balance is not checked; posterior-circulation strokes and many real presentations will not show in these four checks. Hence the "cannot rule out" wording everywhere. |
| **Camera/mic environment** | Lighting, glasses, facial hair, head yaw, camera field of view, background noise, cheap mics, accents and non-native speakers remain risks. The arm screen uses a live framing outline rather than promising a distance. The acted-slur demo requires the phoneme preflight to be green; DSP-only fallback is deliberately conservative. |
| **Left/right mapping unverified** | True: GETTING-STARTED section 8 (`?debug=1`) has not been run on hardware. Do it before demo day (5 minutes). |
| **Email-to-SMS is best-effort** | True: no delivery receipt, Verizon-only (AT&T and T-Mobile closed their gateways; Verizon's ends 2027-03-31), carriers may delay/filter. It was chosen because Twilio trial numbers are blocked by US carriers and registration needs a paid account, which the rules forbid. Backup: the result screen shows "Alert sent" only for what the server accepted, and a teammate watching the phone. |
| **Free-tier limits** | ElevenLabs agent minutes/credits, Gmail SMTP daily limits, Gemini free tier (off by default, may train on submissions). Plan and limits for ElevenLabs are still an open item in spec 00. |
| **Single-person testing** | Yes: speech demo anchors use seven clips from one actor (healthy variants plus acted deficits). There is no meaningful diversity of voice, accent, skin tone, age, facial hair, disability, camera or real dysarthria. |
| **Voice agent latency/reliability** | Third-party streaming LLM: expect 1-2 s turn latency, occasional talk-over, and it has never been verified end to end. The app state machine, not the agent, owns the flow, and every step has on-screen text. The documented "browser speechSynthesis fallback" does not exist in code. |
| **Overclaim risk** | Current UI and agent copy say one alert text goes to the configured demo contact and explicitly tell the user to call 911; speech copy describes the optional phoneme check, not a nonexistent transcript. The remaining risk is a stale live-agent dashboard configuration, so run the probe before presenting. |
| **"Where is the deployment?"** | Vercel/Railway artifacts and instructions exist, but the final backend origin is not recorded and the CSP still uses a Railway wildcard. Prefer the rehearsed laptop path until the deployed preflight and CORS checks pass. |
| **Privacy of the voice guide** | ElevenLabs sees mic audio while connected. Retention was cut to 1 day with recording off (per STATUS), but account-level training opt-out and zero-retention mode are not done. Disclosed at consent. |
| **No licence file** | Repo has no `LICENSE`. Third-party: MediaPipe models Apache-2.0; phoneme model has no declared licence (base wav2vec2 Apache-2.0, TIMIT fine-tune), credit it; fonts are OFL; the drilldown menu is adapted from 21st.dev (ruixen.ui). |

---

## 3. Top 12 improvements

Ranked by (judging impact) / effort. "<1h safe" = low risk of breaking the demo path if done carefully with `pnpm test`.

| # | Improvement | Component | Effort | <1h safe? |
|---|---|---|---|---|
| 1 | **Rehearse the live path 3 times** on the demo laptop and log results in STATUS: `?debug=1` left/right check (GETTING-STARTED section 8), arms distance at the demo spot, real-mic speech run, one full agent conversation. Nothing else on this list matters if this fails. | All | M | Yes (no code) |
| 2 | **Pre-demo readiness screen**: backend, browser/media, MediaPipe, alert provider/destination, both agents and phoneme inference. | Frontend + backend | Done | **Done** (`?preflight=1` or footer) |
| 3 | **Record a 2-minute backup video** of the full happy path plus the phone receiving the text; keep it on the laptop desktop and a phone. Also save a screen recording of the demo panel run. | Presentation | S | Yes |
| 4 | **Fix the agent's false claims**: the app and saved prompt now say an alert text goes to the demo contact, never that emergency services are being contacted. | Agent | Done | **Probe the live agent before stage** |
| 5 | **Fix the healthy-run band**: `CAUTION_RISK` is now `0.3`, pinned by a regression test so healthy-anchor inputs remain in the low band. | Risk | Done | **Done** |
| 6 | **"What the AI saw" panel** on the result screen: replay the drawn landmarks (`overlayDraw.ts`) as a small still/loop and show the two numbers behind each verdict (mouth-corner lift L vs R, arm angle L vs R). Numbers only, no video stored (memory only). Makes the explainability visible to non-engineers. | Vision + UX | M | Partly (numbers-only version is <1h) **Done 2026-09-19: numbers-only version (collapsed "The numbers behind each check" panel, no replay)** |
| 7 | **A clear 3-step explanation on the home screen** ("1 Allow camera and mic  2 Do four 20-second checks  3 See what was flagged; a text goes to the demo contact only if the score is high"), above the consent panel in `HomePage.tsx`. | UX | S | Yes **Done 2026-09-19: one quiet line under Start the check, not a card** |
| 8 | **Shareable results summary that keeps no health data**: a "Copy summary" button on `ResultScreen.tsx` that builds a plain-text block client-side (checks run, flags, time, disclaimer) into the clipboard for a paramedic/family member; nothing is sent or stored, and Clear my data wipes it. | UX / privacy | S | Yes **Done 2026-09-19: Copy summary button on the result screen** |
| 9 | **Demo-safe alert preview**: in the countdown modal and result screen show the exact SMS text that will be sent (the backend already builds it, `services/email_sms_service.py`), plus "Delivery is best-effort" when live. Turns the flakiest step into a legible one. | Alerts | S | Yes **Done 2026-09-19: alert preview in the countdown and result screen (golden-vector tested)** |
| 10 | **Commit any validation numbers you have**, even tiny ("0 false alarms in N healthy runs, upper 95% bound X%") to `docs/validation/` via `pnpm validate` / `python -m models.validate`, and quote them with the "mimicked, not patients" caveat. Even N=20 healthy runs beats none. | Validation | M | Yes (data collection ~1h) |
| 11 | **Multilingual voice guide (Spanish first)**: Spanish UI, prompt, agent selection and failure paths are implemented. | Agent + UX | Done | **Native-speaker/live-agent review remains** |
| 12 | **Deploy or state clearly**: Docker/Railway and Vercel configuration exist. Replace the CSP wildcard with the real backend origin and verify the deployed preflight before sharing a URL. A license/third-party attribution file remains useful. | Deploy / legal | M | Verify, do not improvise on stage |

Other cheap polish: a visible "Demo / not a medical device" ribbon in the header while `?demo=1`; a large-type/high-contrast toggle and captions for the agent (transcript strip already exists) for the accessibility story; a Balance self-report question at the end (see Q&A) clearly labelled as not measured.

---

## 4. Pitch and demo script

### 90-second pitch (spoken)
> **[0:00]** "Every minute of a stroke costs about two million neurons, and most people don't know what to look for. The standard is BE-FAST: Balance, Eyes, Face, Arms, Speech, Time.
> **[0:15]** StrokeShield is a **guide** that walks anyone through four of those checks using just a laptop camera and mic, narrated by an ElevenLabs voice assistant. It is a demo. It is **not a medical device, it is not validated, and it cannot diagnose or rule out a stroke.**
> **[0:30]** The camera work runs in your browser with MediaPipe: video never leaves the device. You follow a dot with your eyes, smile, hold your arms out, and read one sentence. Each check gives a severity and a confidence, not a verdict.
> **[0:50]** A transparent noisy-OR score combines them. You can see the arithmetic. If it crosses the threshold, a ten-second cancelable countdown starts and, in this demo, one text goes to a single teammate's phone with a map link. A red 911 button is on screen the whole time, and the app never tells you you're fine.
> **[1:10]** What's honest: thresholds are uncalibrated, we tested on teammates mimicking deficits, not patients, and Balance isn't checked. What we built is the safety engineering and the validation harness to make real claims possible.
> **[1:25]** Let me show you."

### 3-minute demo script (exact clicks)
Setup: laptop on `http://localhost:5173/`, backend running, `DRY_RUN=false` (live) or true, teammate phone visible to the audience, agent voice at moderate volume.

| Time | Do / say |
|---|---|
| 0:00-0:20 | Home screen. Say: "One consent screen before anything is captured." Tick the consent box, allow camera, mic, location. Point at the disclaimer: "not a diagnosis". |
| 0:20-0:35 | Click **Start guide** (voice) then **Start the check**. Agent greets; say "No, nothing urgent" and "about ten minutes ago" (last known well). |
| 0:35-1:05 | **Eyes**: follow the dot. **Face**: serious face, then smile when prompted. Say: "Landmarks are computed in this tab; no video is uploaded." |
| 1:05-1:30 | **Arms**: step back to the floor mark, arms out for 10 s. **Speech**: step close, click **Start recording**, read "You can't teach an old dog new tricks." Say: "Only this short clip goes to our server, in memory." |
| 1:30-1:55 | **Result (healthy)**: read the neutral banner aloud: "These checks did not flag anything. That does not mean you are not having a stroke." Open the dashboard: "This is the arithmetic; every number is uncalibrated." |
| 1:55-2:35 | Press **Shift+D** (or open `?demo=1`) and click **Simulate stroke**. Countdown appears: "Ten seconds to cancel." Let it run. Phone on the table receives the text: hold it up and read it. Say: "One text, to one number from server config; a request can't change it." |
| 2:35-2:50 | Say "Call 911" out loud during a fresh run (or click **Tell someone**): 3-second countdown. Then **Cancel the text**. |
| 2:50-3:00 | Close: "Guide, not diagnosis. Next step: validation on real volunteers, then clinicians." |

### Fallback branches
| If | Do / say |
|---|---|
| **Camera fails or is denied** | "Browsers ask for permission every time; it's protecting you." Click the lock icon, allow, retry once. If it still fails, go to demo mode: press Shift+D, **Simulate healthy** then **Simulate stroke**, say "same scoring and alert code, simulated inputs; the live capture is in this video" and play the backup clip. |
| **Mic fails** | The speech screen shows the reason. Click **Skip this step** (appears after 15 s): "Missing checks are dropped, never guessed." Continue; the score uses what was measured. |
| **Wifi drops** | Everything except the voice agent and email-to-SMS works locally (models are served from our origin; backend is on this laptop). Say: "The voice guide needs internet; the checks don't." Continue on-screen instructions; show the alert in DRY_RUN and read the message from the dry-run badge / backend log. |
| **Text doesn't arrive** | Do not blame the phone. Say: "This is email-to-SMS through the carrier gateway, best-effort with no receipt; that's exactly why the app also shows the alert status and keeps 911 one tap away." Show the backend log line / Gmail Sent folder; teammate confirms on their phone a minute later. Never resend more than once (2-minute limit). |
| **Agent is silent / garbles** | Click **End guide**, then **Start guide** once. If still silent: "The state machine, not the voice, runs the flow": continue with on-screen instructions and the transcript strip. |
| **Speech scores oddly high on stage** | Acknowledge: "Noisy room; speech alone can never trigger an alert, by design." Re-record once in a quieter spot. |
| **Judge asks you to fake a stroke live** | Do it via the demo panel or mimic a droop; say the caveat: "mimicry is not a patient." |

---

## 5. Judge Q&A

1. **How accurate is it?** "We don't know, and we say so in the app. Thresholds are uncalibrated and there is no clinical validation. We built a protocol for held-out testing with confidence bounds, but a teammate mimicking a droop isn't a stroke patient. Today it's a guide, not a measurement."
2. **Why doesn't it diagnose?** "Because it can't, and a wrong reassurance could delay care. The result never says 'you're fine'; the voice agent is forbidden from diagnosing, and the verdict is a transparent score, not an LLM's opinion."
3. **What happens to my data?** "Video and landmarks stay in your browser. The speech clip goes to our server, is analysed in memory and discarded. If you opt into the voice guide, mic audio streams to ElevenLabs (we set recording off and one-day retention; see PRIVACY.md). The alert text passes through Gmail and the carrier. No database, no analytics. Designed to minimise data, not certified compliant with anything."
4. **Why free APIs?** "The event rules only allow free/public ones. It's also why alerts use email-to-SMS instead of Twilio, whose trial numbers US carriers block and whose registration is paid. In production you'd pay for a registered sender."
5. **What happens in a real emergency?** "Today, an alert goes only to a demo number, never to emergency services, and the red button dials 911 from the person's own phone. We don't dial 911 for you, deliberately. Anyone with real symptoms should call 911 first, not use this."
6. **False alarms?** "Expected, and we measure them: the validation tooling reports false alarms on healthy runs with an upper 95% bound. Right now the honest answer is that a healthy person can land in the 'caution' band, and one strong signal can trigger the countdown, which is cancelable in 10 s and only texts a teammate."
7. **Accessibility?** "The UI is keyboard-reachable, high-contrast, respects reduced motion, and every voice step also has on-screen text with skip paths. English and Spanish flows exist. Gaps: the Spanish copy needs native review, camera checks assume a person can sit or stand in frame, and speech checks are not valid for speech differences unrelated to stroke."
8. **Who benefits?** "Bystanders and people alone who freeze and can't remember the checklist; caregivers; and as an education tool for BE-FAST. It is not for patients to rely on."
9. **Roadmap?** "Deploy; record N volunteers, tune, freeze, validate on held-out people; verify left/right and framing on many cameras; multilingual voice; real contacts with consent and a registered SMS sender; clinician review of wording and thresholds."
10. **What would make it clinical?** "Prospective data on real patients and controls against a clinical reference (stroke-team exam, imaging), regulatory review (FDA/CE software as a medical device), quality system, security and privacy compliance (BAAs, HIPAA/GDPR), usability testing, and post-market monitoring. None of that exists yet."
11. **Balance (the B) isn't checked.** "Correct. A webcam can't reliably assess balance safely, and asking someone with possible stroke to stand and walk is a fall risk. The info page says Balance is not checked, and the agent says so. A self-reported 'sudden dizziness or loss of balance?' question is a possible safe addition."
12. **Licences and attribution?** "MediaPipe face and pose models are Apache-2.0 (Google). The optional phoneme scorer uses a community wav2vec2 TIMIT fine-tune with no declared licence (base model Apache-2.0, TIMIT is LDC-licensed), so it's optional and credited, and it isn't required for the demo. Fonts are self-hosted OFL (Newsreader, Nunito Sans); the drilldown menu is adapted from 21st.dev (ruixen.ui). Stroke statistics on the info page are cited from published papers, not our results. We should add a LICENSE and THIRD-PARTY file."

---

## 6. Demo-day checklist

**T-60 min**
- [ ] Charge the laptop and the demo phone; a **second teammate phone** on the same carrier as backup; tether/hotspot ready.
- [ ] Pull `main`, `cd frontend && pnpm install && pnpm test && pnpm typecheck`; `pytest` green.
- [ ] `.env` present (never in git): `DEMO_PHONE_NUMBER` = the consenting teammate's Verizon number; `ALERT_CHANNEL=email_sms`, `SMTP_USER`, `SMTP_APP_PASSWORD`, `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_AGENT_ID_ES`; `SECOND_OPINION=false`.

**T-30 min**
- [ ] Start servers: `uvicorn backend.main:app --port 8000` and `cd frontend && pnpm dev` (or a production build); open `http://localhost:5173/`; check `http://localhost:8000/api/health`.
- [ ] `python scripts/sms_check.py` (read-only): every line PASS.
- [ ] **DRY_RUN choice:** default `true`. For a live text, set `DRY_RUN=false`, restart the backend, run `python scripts/sms_check.py --send` once and confirm receipt on the phone (allow up to a minute), then decide: live for the demo, or back to `true` and read the dry-run message. One alert per 2 minutes: do not burn it on tests right before the stage. Set back to `true` after the event.
- [ ] Confirm the badge on the demo panel (`?demo=1`) says the intended mode ("live texts armed" vs dry run).
- [ ] Chrome: allow camera, mic, location for `localhost`; pick the right camera/mic; close other apps using the camera; disable notifications.
- [ ] `?debug=1`: raise right hand / left hand / smile on one side; labels must follow the correct side.
- [ ] Mark an arms floor spot where the live outline turns green and both wrists remain in frame; front light on the face, no window behind you, no strong backlight, glasses glare check.
- [ ] Run one full healthy pass + one demo-panel "Simulate stroke" + cancel. If phoneme scoring is on (`PHONEME_SCORING=true`), confirm warm-up finished and RAM is fine.
- [ ] Screen recording of a complete run saved locally and on a phone; the `?demo=1` path rehearsed as the camera fallback.
- [ ] Open `?preflight=1`; resolve every red row. Remember that it verifies configuration, not carrier delivery or a full ElevenLabs conversation.
- [ ] Agent: Start each English and Spanish guide once, confirm it speaks and responds; volume set; ElevenLabs credits not exhausted.
- [ ] Notifications off, network stable, clear old tabs; note venue Wi-Fi vs hotspot.
- [ ] Teammate who owns the receiving phone knows the exact time and stays reachable; agree on the phrase to confirm the text out loud.
- [ ] Slides/pitch include the disclaimer, "not validated", and "Balance not checked".

---

## 7. Factual consistency pass

The earlier review found stale emergency-call, transcript, Twilio, deployment, bilingual and threshold claims. Those have
been corrected across the app, agent prompts, environment template, specs, privacy map and this runbook. Before judging,
the remaining consistency check is operational rather than editorial:

- Probe both saved ElevenLabs agents and confirm their live prompts/tools match `docs/agent-prompt*.md`.
- Confirm the configured provider sends only to `DEMO_PHONE_NUMBER`; configuration readiness is not delivery proof.
- Keep the geographic limitation explicit: `tel:911`, linked hotlines and carrier gateway guidance are US-specific.
- Never describe the seven acted speech recordings as clinical validation or the optional phoneme score as a transcript.
