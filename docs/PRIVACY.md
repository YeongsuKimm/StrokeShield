# StrokeShield: Privacy and Data Handling

> Current configured posture (last checked 2026-09-19): alerts default to **email-to-SMS** through Gmail and the carrier gateway; Twilio is legacy. Both ElevenLabs agents have audio saving off, one-day retention, no data-collection/evaluation fields, and file input off. Zero-retention mode and the account-level training opt-out remain unverified; re-run the privacy script before quoting the live settings.

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
| **Voice-agent conversation audio** (the mic streams live to ElevenLabs while the guide is connected) | Browser (`@elevenlabs/react`, from **Start guide**) | **ElevenLabs** (WebSocket via signed URL from `/api/agent/signed-url`). Agent speech comes back the same way. Audio is muted toward the agent during the speech recording (`speechAudioGate.ts`) | Audio saving is configured off and saved audio deletion on; conversation metadata/transcripts have one-day retention. Zero-retention mode is not enabled. See section 3 | User, ElevenLabs staff/subprocessors, dashboard owners (agent creator and admins) |
| **Conversation transcript** (what the user and agent said, including any last-known-well answer) | ElevenLabs (STT) and browser (`onMessage` -> `store.transcript`) | ElevenLabs processes it; browser keeps it in memory for the transcript strip. Post-call data collection and evaluation are configured off | Browser: no. ElevenLabs: configured for one-day retention | User, ElevenLabs and its subprocessors |
| **Test context sent to the agent** (phase name, "recorded"/"could not get a clear reading" per test, mic-mute events) | Browser (`useAgent.ts`, `clientTools.ts`) | ElevenLabs (contextual updates / tool results). No scores, no landmarks, no location, no name | Yes, inside the conversation record above | As above |
| **Patient name** | Optional legacy contract field; **no UI sets it today** | Accepted by the backend but deliberately omitted from both alert-provider message builders | No | n/a today |
| **Last known well** | Spoken to the agent; stored in memory by the `record_last_known_well` tool | Backend `/api/alert` -> SMS (clipped to 120 chars). Also in the ElevenLabs transcript | Backend: not stored. ElevenLabs: yes | Alert recipient; ElevenLabs |
| **Symptoms** (analyzer flag strings, no free text from the user) | Browser | `/api/alert` -> SMS | Not stored by us | Alert recipient |
| **Location** (GPS fix, only if the user grants it) | Browser (`navigator.geolocation` at the consent card) | Kept in memory; sent **only** in the alert to our backend, which puts a rounded `maps.google.com/?q=lat,lng` link into the text. Not sent to ElevenLabs or Gemini | Not stored by us. Gmail/carrier systems process the alert; Twilio does so only on the legacy channel | Alert recipient; configured delivery providers and carriers |
| **Alert text** (flags, last known well, rounded location link, risk %, "Demo message"; no name) | Backend `services/email_sms_service.py` by default; Twilio only if explicitly configured | Gmail SMTP -> carrier gateway -> `DEMO_PHONE_NUMBER` only. Logs record length/error type, never content | Not stored by our code. Gmail, the carrier and receiving phone apply their own retention; legacy Twilio retains message records | Demo phone owner, Google/Gmail, carrier; Twilio only on the legacy channel |
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
- **Live agent config (last checked 2026-09-19):** both agents had `record_voice: false`, saved-audio deletion on, `retention_days: 1`, data collection/evaluation empty and file input off. `zero_retention_mode` was still off. Account-level training opt-out was not verified. Run `python scripts/elevenlabs_privacy.py` again before a public demo because dashboard settings can drift.

### Gmail and carrier email-to-SMS (default alert path)
- The one alert email passes through the configured Gmail account and carrier gateway. Delivery is best-effort, has no receipt, and provider/carrier retention is outside this codebase. Use only a consenting teammate's number and synthetic demo details.

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
3. **Voice guide (optional):** if you press Start guide, your microphone audio and words go to ElevenLabs. Audio saving is off; a transcript may be kept for up to one day.
4. **Location (optional):** shared only if a text alert is sent, as a map link in that one message.
5. **Text alert:** in this demo it goes through Gmail and a carrier gateway to one pre-approved phone number; those providers and the phone may retain it.
6. This is a demo, not a medical device or a diagnosis. Do not enter real medical information. You can stop at any time; closing the page ends the session.

### 5.2 In-app disclosure
The home consent card and Methods FAQ disclose on-device camera processing, the transient backend speech clip, optional ElevenLabs stream, optional location, and the alert path. Keep `frontend/src/lib/privacy/consentText.ts` and `frontend/src/components/pages/infoContent.ts` aligned with this data map.

### 5.3 Consent line before "Start guide" (checkbox, unticked by default)
> "The voice guide streams your microphone to ElevenLabs. Audio saving is off, but ElevenLabs may keep a transcript for up to one day. Continue?"

## 6. Historical audit findings and remaining account checks

**Owner checks in the ElevenLabs dashboard**
1. Re-run the read-only privacy check and confirm **audio saving remains off**, saved-audio deletion remains on, and `retention_days` remains 1 for both agents.
2. Try enabling **Zero Retention Mode**; expect it may need an enterprise plan. Note it restricts LLM choice and disables transcript/analysis history. Decide whether that is acceptable for the demo.
3. Confirm **data-collection/evaluation fields remain empty** and **file input remains off**.
4. Account level: turn **off "Improve the models for everyone"** (default on for non-enterprise tiers).

**Frontend (`frontend/src`)**
1. `?record=1|vision|speech` calibration mode remembers a subject label in `localStorage`; keep it for consenting team calibration only and do not expose it as a public workflow.
2. If the second-opinion feature is wired: require a separate unticked opt-in with plain-language warning, a paid/private provider posture, small just-in-time frames, and no client storage.

**Backend / infra**
1. **Second opinion on the free Gemini tier conflicts with Google's own "do not submit personal information" rule.** Keep it off for the public demo unless moved to an appropriate paid/private posture.
2. Check Railway/Vercel log retention; the container already disables uvicorn access logs.
3. For legacy Twilio, consider Message Body Redaction and deleting demo messages after the event. Both alert builders now omit `patient.name` and round email-to-SMS locations.
4. Do not implement ElevenLabs Scribe for the speech clip without `enable_logging=false` (enterprise) or an explicit consent line; today no speech-test clip goes to ElevenLabs.
5. The signed-URL endpoint is rate-limited but unauthenticated; a public deployment can still consume agent credits. Monitor usage or add an access gate after the demo.

## 7. Decisions needed from a human
- Keep second opinion off, or fund an appropriate paid/private implementation?
- Can the account enable ElevenLabs zero-retention mode, and is the account-level training opt-out enabled?
- Who handles deletion requests, and what contact address goes in the UI?
