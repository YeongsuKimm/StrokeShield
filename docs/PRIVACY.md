# StrokeShield: Privacy and Data Handling

Audience: engineers and judges. Status: **designed to minimize data; not certified compliant with any regime.**
Verified against the code and against the live ElevenLabs agent config on **2026-09-19**. Vendor terms change: re-check the linked pages before any public launch.
StrokeShield is a hackathon demo, **not a medical device**, and not intended for real patients or for anyone under 18.

## 1. Principles (what the design already does)
1. **Analyze on the device.** Camera video and face/pose landmarks are processed in the browser (MediaPipe wasm and models are served from our own origin; no CDN, no analytics, no fonts from third parties).
2. **Store nothing.** The backend has no database and writes no files; the frontend keeps results in memory (Zustand, no persistence) and they vanish on reload.
3. **Send only what a feature needs**, to one named recipient per feature, and say so before it happens.
4. **The SMS goes only to `DEMO_PHONE_NUMBER`** (env, never from a request). `DRY_RUN` defaults to on.
5. **No PII in logs.**

## 2. Data map (derived from the code)

| Data | Created | Goes to | Stored? / retention | Who can see it |
|---|---|---|---|---|
| **Camera video and frames** | Browser (`getUserMedia`, `<video>`) | MediaPipe in the same tab only. **Never uploaded** (only `speech.wav`, the alert JSON and the optional second-opinion JPEGs are ever POSTed; see `frontend/src/lib/api.ts`) | No. Held in the video element / memory until the stream stops | The user |
| **Face / pose / eye landmarks and blendshapes** (face geometry: biometric-like) | Browser (MediaPipe) | Pure metric functions in the same tab. Not sent anywhere. Only derived severities, flags and confidences leave the tab (in the alert: flag text such as "left mouth corner lower") | No (memory only), **except** the opt-in `?record=` calibration mode below | The user |
| **Mic audio, speech clip** (voice is biometric-like) | Browser, 16 kHz WAV, only after the user presses **Start recording** | `POST /api/speech/analyze` to **our backend** (5 MB cap). The clip is analysed in memory and discarded; the `speech` router logs only byte count, timing, severity, confidence. **Not sent to ElevenLabs Scribe today** (`models/transcribe.py` is an interface only; no provider is implemented) | Not persisted by our code. Hosting-layer request logs (Railway/proxy) may record metadata (IP, path, size), not the body | Backend process only, transiently |
| **Voice-agent conversation audio** (the mic streams live to ElevenLabs while the guide is connected) | Browser (`@elevenlabs/react`, from **Start guide**) | **ElevenLabs** (WebSocket via signed URL from `/api/agent/signed-url`). Agent speech comes back the same way. Audio is muted toward the agent during the speech recording (`speechAudioGate.ts`) | **Yes, at ElevenLabs.** Live agent config today: `record_voice: true`, `retention_days: -1` (keep forever), `zero_retention_mode: false`. See section 3 | User, ElevenLabs staff/subprocessors, dashboard owners (agent creator and admins) |
| **Conversation transcript** (what the user and agent said, including any last-known-well answer) | ElevenLabs (STT: `scribe_realtime`) and browser (`onMessage` -> `store.transcript`) | ElevenLabs stores it; browser keeps it in memory for the transcript strip. The live agent also runs **post-call analysis** (`data_collection`: concern summary, last-known-well, emergency triggered; `evaluation` criteria) with **`gemini-2.5-flash`** | Browser: no. ElevenLabs: yes, same retention as audio (`-1`) | User, ElevenLabs, its LLM subprocessors |
| **Test context sent to the agent** (phase name, "recorded"/"could not get a clear reading" per test, mic-mute events) | Browser (`useAgent.ts`, `clientTools.ts`) | ElevenLabs (contextual updates / tool results). No scores, no landmarks, no location, no name | Yes, inside the conversation record above | As above |
| **Patient name** | Contract field only (`patient.name`); **no UI sets it today** | Would go to the backend and into the SMS | No | n/a today |
| **Last known well** | Spoken to the agent; stored in memory by the `record_last_known_well` tool | Backend `/api/alert` -> SMS (clipped to 120 chars). Also in the ElevenLabs transcript | Backend: not stored. ElevenLabs: yes | Alert recipient; ElevenLabs |
| **Symptoms** (analyzer flag strings, no free text from the user) | Browser | `/api/alert` -> SMS | Not stored by us | Alert recipient |
| **Location** (GPS fix, only if the user grants it) | Browser (`navigator.geolocation` at the consent card) | Kept in memory; sent **only** in the alert to our backend, which puts a `maps.google.com/?q=lat,lng` link into the SMS. Not sent to ElevenLabs or Gemini | Not stored by us. Twilio stores the SMS body (below) | Alert recipient; Twilio; carriers |
| **Alert text** (flags, last known well, location link rounded to 4 decimals, risk %, "Demo message"; no name) | Backend `services/email_sms_service.py` (email over Gmail SMTP to the carrier's text gateway; Twilio only if `ALERT_CHANNEL=twilio`) | **Twilio** -> `DEMO_PHONE_NUMBER` only. Logs record length and error code, never the text | **Twilio keeps the message record and body** (see section 3); the phone keeps the SMS | Demo phone owner, Twilio, carriers |
| **Gemini second-opinion still frames** (face/arms JPEGs, personal data) | **Not captured today.** The frontend never sends frames (`api.secondOpinion` exists but nothing calls it); the backend code is ready | If wired: our backend -> Google Gemini API (`generativelanguage.googleapis.com`). Backend logs no image data or response text | Not stored by us. **Free tier: Google may use and human-review it** (section 3) | Google; the user |
| **Calibration recordings** (`?record=1|vision|speech`, team tooling) | Browser | Downloaded as `.json` (landmark frames, subject nickname, conditions, device info) and `.wav` **to the operator's own disk**; nothing uploaded. Subject and conditions are remembered in `localStorage` | On local disk until deleted; `frontend/recordings/` and `recordings/speech/` are gitignored. Consented fixtures may be committed | The team |
| **Logs** | Backend (`logging`), browser (`console.debug`) | Backend stdout / host logs; nothing is sent to a logging service | Host-dependent. Access logs (uvicorn/Railway/Vercel) include IP + path | Team/host |
| **Secrets and config** (`.env`) | Local | Gitignored; keys never in `frontend/` | n/a | Team |

Not present (checked): analytics/telemetry SDKs, cookies, `sessionStorage`/IndexedDB, third-party CDNs, server-side file writes, a database.

## 3. Third-party terms (official sources; checked 2026-09-19)

### ElevenLabs (Agents, and Scribe if we ever add it)
- **Retention default:** conversation data (transcripts **and** audio, both user and agent) is kept **2 years** by default. `retention_days` can be set to any number, `-1` = unlimited, `0` = scheduled deletion. Audio saving can be switched off separately. No plan restriction is stated on these two. <https://elevenlabs.io/docs/eleven-agents/customization/privacy/retention>, <https://elevenlabs.io/docs/eleven-agents/customization/privacy>
- **Zero Retention Mode (ZRM):** no recordings, and no transcripts or PII-bearing metadata stored post-call; data only via post-call webhook. Per-agent toggle (Privacy > Advanced, or `privacy.zero_retention_mode`). The agents page does not state a plan; the API-level page says ZRM is available to **select enterprise customers**, UI traffic is not covered, and support/debugging is limited. When ZRM is on, LLM choice is restricted to providers with no-train/no-retain commitments (per ElevenLabs' orchestration blog). <https://elevenlabs.io/docs/eleven-agents/customization/privacy/zrm>, <https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode>
- **Scribe (speech to text):** zero retention is `enable_logging=false` on `/v1/speech-to-text/` requests, **enterprise only**; without it audio/text is subject to normal history. Not used by our code today. Same page as above.
- **Training use:** Enterprise: no training by default. All other tiers: ElevenLabs "uses certain data you provide" to improve its models **by default**; opt out per account at *Terms and privacy > Data use > "Improve the models for everyone"*; applies only to data submitted after opting out. <https://elevenlabs.io/docs/help-center/legal/is-my-data-used-to-improve-eleven-labs-ai-models>, <https://elevenlabs.io/privacy-policy>
- **HIPAA:** a BAA is available on **Enterprise only**, requires ZRM and restricts LLMs. We have none. <https://elevenlabs.io/docs/eleven-agents/legal/hipaa>
- **Live agent config (read-only GET, 2026-09-19):** `record_voice: true`, `retention_days: -1`, `delete_audio: false`, `delete_transcript_and_pii: false`, `zero_retention_mode: false`, PII redaction off, user memory off, `enable_auth: false`, agent LLM `qwen35-397b-a17b`, **post-call analysis LLM `gemini-2.5-flash`**, 5 data-collection fields and 4 evaluation criteria active, `file_input.enabled: true`, max call 600 s. **This is the least private setting: audio and transcripts are kept indefinitely.** Recommended dashboard changes are in section 6.

### Twilio (SMS)
- **Retention:** Twilio keeps production access to message data for up to 24 hours, then holds it in limited-access compliance storage; message logs and the Messages API show records for about 13 months (400 days) by default; a `DELETE` on the message removes the record but bodies can persist up to 30 days in backups. <https://help.twilio.com/articles/223181008-Twilio-SMS-message-and-traffic-storage> (as summarised by search, re-open to confirm), <https://www.twilio.com/docs/messaging/api/message-resource> (body `deleteSla: 30`), <https://support.twilio.com/hc/en-us/articles/223133687-Deleting-messages-message-media-or-message-bodies>
- **Redaction:** optional Message Body and Phone Number Redaction hides content from Console/API/support (unredacted data still lives up to 24 h in production). Available on all editions, needs setup. <https://www.twilio.com/docs/messaging/guides/privacy-message-redaction>
- **Trial account:** can message **verified recipients only**; Twilio's trial docs also say trial accounts use Twilio-provided templates and custom message bodies "aren't available during trial", and the usual trial banner ("Sent from your Twilio trial account -") is prepended to SMS. Confirm with `python scripts/sms_check.py --send`. <https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account>
- **HIPAA:** we have no BAA; do not put real health data in SMS.

### Google Gemini API (only if second opinion is wired)
- **Unpaid (free) tier:** Google uses submitted content and responses "to provide, improve, and develop Google products and services and machine learning technologies"; **human reviewers may read, annotate and process** API input and output (disconnected from account/key/project first); and the terms say **"Do not submit sensitive, confidential, or personal information to the Unpaid Services."** A face photo is personal information.
- **Paid tier:** Google does not use prompts or responses to improve its products; data is logged only for abuse/policy monitoring and legal compliance, temporarily.
- Users in the **EEA, Switzerland and UK** must be served only by Paid Services; users must be 18+. <https://ai.google.dev/gemini-api/terms>

## 4. Honest compliance posture

Not legal advice. **We do not claim compliance with any law or standard.** Say "designed to minimize data", never "compliant", "secure" or "HIPAA-safe".

| Regime | Reality for this demo | What we can say | What to do |
|---|---|---|---|
| **HIPAA (US)** | A hackathon team offering a public demo is probably not a covered entity or business associate, but if it ever handled PHI for a provider it would be. We have **no BAAs** (ElevenLabs BAA is enterprise + ZRM only; none with Twilio, Google, hosts). | "Not a medical device. Not HIPAA compliant. Do not enter real medical information." | Never claim HIPAA. Keep real patient data out; use consenting teammates. |
| **GDPR / UK GDPR** | If EU/UK people use it, we are a controller. Health data and biometric data used to identify are **special category** (Art. 9): needs **explicit consent**, minimization, purpose limits, transfer safeguards (ElevenLabs, Twilio, Google are US-based), erasure on request. Gemini free tier is barred for EEA/UK/CH users. | "We ask for explicit consent before the camera, mic, voice guide or location; nothing is stored by us; you can end the session and your data is gone." | Consent before capture, separate opt-in for each outside recipient, a way to ask for deletion (contact + ElevenLabs conversation delete), no EU/UK users on the Gemini free tier. |
| **CCPA/CPRA (California)** | Thresholds (revenue, volume of consumers' data) likely not met by a hackathon project; health and biometric data are "sensitive personal information" if it applied. | "We do not sell or share personal information." (true today) | Notice at collection, no sale/sharing, honor deletion requests. |
| **Biometric laws: Illinois BIPA, Texas CUBI, Washington (RCW 19.375 and the My Health My Data Act)** | BIPA covers face geometry and **voiceprints** and requires informed written consent and a public retention policy, with a private right of action. CUBI needs notice and consent before capture and destruction within a limit (AG enforced). Washington adds consumer-health-data consent and privacy-policy rules. Whether on-device landmarks that identify no one count as a "biometric identifier" is arguable, but **voice audio kept at ElevenLabs and any face photo sent to Gemini are the risky parts**. | "Face and pose analysis runs on your device and is not saved. We do not build face or voice templates or identify anyone." | Consent screen **before** capture; no retention of face data (already true); shorten or disable ElevenLabs audio retention; retention statement in the UI. Be careful recording audience members at the demo table. |
| **Minors** | Not designed for under 18 (Gemini terms also require 18+). | "For adults." | Add to consent copy. |

Measures achievable in a demo (most are already true): consent before capture, opt-in for anything that leaves the browser, no server storage, deletion path, minimal SMS, no analytics, SMS only to a consented `DEMO_PHONE_NUMBER`.

## 5. Recommended user-facing copy

### 5.1 Six-line plain-language summary (home page, near the consent card)
1. **Camera:** your face and arms are analyzed on this device. Video is never uploaded or saved.
2. **Microphone (speech check):** a short clip goes to our server, is analyzed, and is deleted immediately.
3. **Voice guide (optional):** if you press Start guide, your microphone audio and what you say go to ElevenLabs, which may keep a recording and transcript unless we tell you otherwise here.
4. **Location (optional):** shared only if a text alert is sent, as a map link in that one message.
5. **Text alert:** in this demo it goes to one pre-approved phone number and is stored by our SMS provider (Twilio).
6. This is a demo, not a medical device or a diagnosis. Do not enter real medical information. You can stop at any time; closing the page ends the session.

### 5.2 Corrected FAQ entry (replaces `FAQS` "What happens to the video and audio?" in `infoContent.ts`)
Current text: *"The video never leaves your browser ... The speech clip is sent to our server for analysis and is not stored. Still frames are only sent for a second opinion if you tick that box yourself."*
It does **not** disclose the voice guide, transcripts, location, the SMS provider, or vendor retention. Suggested replacement:

> **q:** What happens to my video, voice and data?
> **a:** Your video never leaves your browser: face and arm detection run on this device and nothing is recorded. The speech check sends one short audio clip to our server, which analyzes it and discards it; we do not save it. If you turn on the voice guide, your microphone audio and words are streamed to ElevenLabs, our voice provider, which processes them under its own terms and may keep a recording and transcript (we are working to minimize this). If a text alert is sent, it goes to one pre-approved demo number through Twilio and can include your location link, last-known-well time and symptom notes; Twilio keeps message records. Still photos are only sent for an AI second opinion if you tick that box, and Google's free service may review them, so leave it unticked for private use. We use no analytics or ad trackers. This is a demo, not a medical device: do not enter real medical information.

(Tighten wording after the ElevenLabs dashboard changes in section 6 are made; if audio saving is off, replace "may keep a recording and transcript" with the actual retention.)

### 5.3 Consent line before "Start guide" (checkbox, unticked by default)
> "The voice guide streams your microphone to ElevenLabs. It may store a transcript (and audio) for up to N days. Continue?"

## 6. Gaps: code vs this document (feed for the backend and frontend agents)

**Owner to change in the ElevenLabs dashboard (READ ONLY here; not modified)**
1. Turn **audio saving off** (`record_voice: false`; `delete_audio`) and set **`retention_days` to a short value (0 or 1)**; current `-1` keeps everything forever. Optionally delete existing conversations (`apply_to_existing_conversations`). Both are documented without a plan restriction.
2. Try enabling **Zero Retention Mode**; expect it may need an enterprise plan. Note it restricts LLM choice and disables transcript/analysis history. Decide whether that is acceptable for the demo.
3. Disable the five **data-collection** fields and the four **evaluation** criteria if unneeded (they send transcripts to `gemini-2.5-flash` for analysis and store extracted last-known-well).
4. Disable **`file_input`** (unused).
5. Account level: turn **off "Improve the models for everyone"** (default on for non-enterprise tiers).

**Frontend (`frontend/src`)**
6. `infoContent.ts` FAQ omits the ElevenLabs mic stream, transcripts, location, Twilio. `PermissionsCard.tsx` says only "Video stays on this device." Use 5.1/5.2.
7. **No consent before Start guide** (`App.tsx`): pressing it streams the mic to a third party. Add the 5.3 gate. The camera/mic/location card also does not say where audio and location go.
8. Location "Tells help where you are" should say it is only sent in an alert; make location clearly optional.
9. `?record=1|vision|speech` (calibration recorder) works on any deployment and remembers a subject name in `localStorage`. Gate it behind a dev/team flag on production builds and show a consent reminder.
10. If the second-opinion feature is wired: **unticked opt-in checkbox with plain-language warning**, hidden or disabled for EEA/UK users, capture <= 512 px JPEG only at the moment needed, never stored client side.
11. Add a visible privacy link/page (footer) with 5.1 and vendor retention; the Home privacy statement and `infoContent.ts` should be updated together.

**Backend / infra**
12. **Second opinion on the free Gemini tier conflicts with Google's own "do not submit personal information" rule.** Use a paid, billing-enabled key, or keep the feature off for the public demo (human decision).
13. Run uvicorn with **`--no-access-log`** (or scrub IPs) and check Railway/Vercel log retention; there is no Dockerfile in the repo yet, so add this when it is written.
14. Twilio: consider **Message Body Redaction**, deleting demo messages after the event, and dropping the exact-location link or rounding coordinates. SMS content stays minimal (already true: no diagnosis, no score breakdown).
15. `patient.name` is accepted by the contract and rendered into the SMS but nothing sets it; either remove it later (contracts change needs sign-off) or keep it off the UI.
16. Do not implement ElevenLabs Scribe for the speech clip without `enable_logging=false` (enterprise) or an explicit consent line; today no clip goes to ElevenLabs.
17. Document in the deploy guide that `.env` keys stay out of the frontend (already enforced) and that the signed-URL endpoint has no auth or rate limit (anyone who can reach the backend can start agent conversations at our cost).

## 7. Decisions needed from a human
- Keep second opinion at all (paid Gemini key, or off)?
- ElevenLabs: accept indefinite retention for demo day, or apply items 1-5 above (needs an owner with dashboard access; the agent creator is the admin)?
- Who handles deletion requests, and what contact address goes in the UI?
