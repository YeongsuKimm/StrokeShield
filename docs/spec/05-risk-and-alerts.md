# 05 — Risk Score & Emergency Alerts

Owner: Backend dev. Files: `frontend/src/lib/risk.ts`, `frontend/src/lib/config.ts`, `services/twilio_service.py`, `backend/routers/alert.py`.

## Risk score (pure function, `risk.ts`, mirrored by a Python check in `/api/alert`)
Noisy-OR so one strong signal can trigger, while several moderate signals also can:

```
contribution_i = maxWeight_i × severity_i × confidence_i
risk = 1 − Π (1 − contribution_i)          # over completed, non-retry tests (+ vision opinion)
triggered = risk ≥ RISK_THRESHOLD           # default 0.5
```
Initial (**uncalibrated**) max weights: `face 0.6`, `arms 0.6`, `speech 0.5`, `eyes 0.3` (stretch), `vision 0.25` (only if `finding=asymmetric`, severity = its confidence).
Severity anchors are shared by every test (spec 02 "Shared conventions"): healthy ≤ 0.15, borderline ≈ 0.35, clear ≥ 0.85. Consequences of the current weights: a clear face or arm deficit alone triggers; a clear eyes deficit alone never does (0.3 < 0.5); a clear **speech-only** deficit (severity 0.9 → 0.45) does NOT trigger. **Open decision:** if the team wants "any one FAST sign triggers" (as in real FAST guidance), raise `MAX_WEIGHTS.speech` to 0.6 and update `consistency.test.ts`.
Result bands (UI only; the alert trigger is still `RISK_THRESHOLD` alone): `low` < 0.3 <= `caution` < 0.5 <= `high`. `CAUTION_RISK` is 0.3, not 0.2, because four healthy checks at the top of the healthy anchor (severity 0.15, confidence 1) already give a risk of about 0.27, and a healthy person must not see "Something showed up". Uncalibrated.

Examples: one test at severity 0.9/confidence 1 → 0.54 (trigger). Two tests at 0.5 → ~0.5 (trigger). One test 0.4 → 0.24 (no).

Rules:
- Tests with `needsRetry` or confidence < 0.3 are excluded and shown as "couldn't measure"; if all are excluded, verdict = "inconclusive — recommend calling if you have any symptoms".
- `user_request` **bypasses the score entirely.**
- Return the full `RiskBreakdown` so the dashboard can show why.

## Trigger flow
1. Score computed after speech test (also recomputed live for the dashboard as each test lands).
2. If triggered (or user requests): **10 s cancelable countdown** (big modal, "Cancel" button, agent says the script, tone/vibration). `user_request` uses a shorter 3 s confirm window.
3. On expiry → `POST /api/alert`. Show status: "Sending… / Sent". Then the agent says the emergency contact is being notified and stays on the line reading calm instructions (sit down, don't eat or drink, unlock the door).
4. Always render a persistent manual `tel:911` button.

## `/api/alert` (backend)
1. Validate body against `AlertRequest`. Ignore/forbid any phone-number fields.
2. If `reason == "risk_threshold"`, recompute risk from `risk.contributions` and confirm `risk ≥ threshold` (sanity check; don't trust the client blindly).
3. `to = DEMO_PHONE_NUMBER` from env; if unset/invalid → HTTP 200 `{ok:false, error}` (never a 500).
4. If dry-run (the default; only an explicit `DRY_RUN=false|0|no|off` arms real sending, so a typo stays dry): log the message *length* (no PII) and return `{dryRun:true}`.
5. Else deliver **one text only** through `ALERT_CHANNEL`: `email_sms` mails the carrier text gateway (`<10 digits>@SMS_GATEWAY_DOMAIN`, default Verizon `vtext.com`, address derived server-side from `DEMO_PHONE_NUMBER`) over Gmail SMTP (`SMTP_USER` + app password, STARTTLS 587, 10 s timeout) with a single-segment body (<= 160 chars, location rounded to 4 decimals, no patient name, control characters flattened so client text can never reach a header); `twilio` is the legacy path below. Same guards on both: env-only destination, `DRY_RUN`, one alert per 2 minutes, generic errors. Email-to-SMS is best-effort with no delivery receipt (Verizon's gateway ends 2027-03-31; AT&T and T-Mobile already shut theirs). Twilio: The app does not create an automated voice call. Free-text fields are clipped to 120 chars. Twilio failures return `{ok:false, error:"SMS could not be sent (Twilio error <code>)"}`: the raw Twilio message (which can echo numbers/SID) is logged type+code only and never returned.
6. Rate limits: the request body is capped at 64 KB (413) and `/api/alert` allows 10 requests/min per client IP (429 + `Retry-After`, `backend/security.py`). Separately, at most 1 live alert per 2 minutes (in-memory) to prevent accidental SMS storms (a lock makes concurrent alerts safe; a failed send does not start the window).

### SMS
`StrokeShield ALERT: possible stroke. Symptoms: {symptoms}. Last known well: {lkw}. Location: https://maps.google.com/?q={lat},{lng} (±{acc} m). Risk {risk:.0%}. Demo message.`

### Failure and demo-mode UX (frontend `AlertStatus.tsx`, `lib/alertFailure.ts`)
- A failed alert (network/timeout, HTTP 429, 5xx, or `ok:false`) is shown with its category (network / rate limited / server / not configured / refused / delivery) and plain wording that never claims a text was sent. **Call 911 now** is the first button; one **Try sending again** button re-sends without a new countdown (`store.retryAlert()`: one-shot, only from a failed alert, so a double click cannot send twice).
- The server's "an alert was sent in the last 2 minutes" refusal is shown as such ("your contact most likely already has it") and the retry button is disabled for 120 s; an HTTP 429 uses its `Retry-After`.
- A `dryRun:true` success is shown as **"Demo mode: nothing was sent"** (no green check), and the voice guide is told the same.

## Location
Request `navigator.geolocation` at the **consent step** (not at alert time, so the prompt doesn't block the emergency). Cache the last fix; include accuracy. If denied, the message says "location unavailable".

## Twilio gotchas
Setup runbook and a read-only readiness check: [../SMS-SETUP.md](../SMS-SETUP.md) (`python scripts/sms_check.py`).

- Trial accounts: the destination may need to be a **verified** number. Confirm it in the Twilio console before the live test.
- SMS to US numbers from an unregistered local number can be filtered; prefer a toll-free/verified sender and test early.
- `twilio` calls are blocking — run in a threadpool or use `run_in_threadpool` so the FastAPI loop isn't stalled.

## Safety checklist (must all be true before the live demo)
- [ ] `DEMO_PHONE_NUMBER` is a teammate's number, with their consent.
- [ ] No code path can dial a request-supplied or hardcoded emergency number.
- [ ] `DRY_RUN=false` only on the demo deployment; default `true` everywhere else.
- [ ] Judges are told the SMS is a simulated emergency alert to a demo number.
