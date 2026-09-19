# 05 — Risk Score & Emergency Alerts

Owner: Backend dev. Files: `frontend/src/lib/risk.ts`, `frontend/src/lib/config.ts`, `services/twilio_service.py`, `backend/routers/alert.py`.

## Risk score (pure function, `risk.ts`, mirrored by a Python check in `/api/alert`)
Noisy-OR so one strong signal can trigger, while several moderate signals also can:

```
contribution_i = maxWeight_i × severity_i × confidence_i
risk = 1 − Π (1 − contribution_i)          # over completed, non-retry tests (+ vision opinion)
triggered = risk ≥ RISK_THRESHOLD           # default 0.5
```
Initial (**uncalibrated**) max weights: `face 0.6`, `arms 0.6`, `speech 0.5`, `vision 0.25` (only if `finding=asymmetric`, severity = its confidence).
Examples: one test at severity 0.9/confidence 1 → 0.54 (trigger). Two tests at 0.5 → ~0.5 (trigger). One test 0.4 → 0.24 (no).

Rules:
- Tests with `needsRetry` or confidence < 0.3 are excluded and shown as "couldn't measure"; if all are excluded, verdict = "inconclusive — recommend calling if you have any symptoms".
- `user_request` **bypasses the score entirely.**
- Return the full `RiskBreakdown` so the dashboard can show why.

## Trigger flow
1. Score computed after speech test (also recomputed live for the dashboard as each test lands).
2. If triggered (or user requests): **10 s cancelable countdown** (big modal, "Cancel" button, agent says the script, tone/vibration). `user_request` uses a shorter 3 s confirm window.
3. On expiry → `POST /api/alert`. Show status: "Calling… / Sent". Then the agent says help is being contacted and stays on the line reading calm instructions (sit down, don't eat or drink, unlock the door).
4. Always render a persistent manual `tel:911` button.

## `/api/alert` (backend)
1. Validate body against `AlertRequest`. Ignore/forbid any phone-number fields.
2. If `reason == "risk_threshold"`, recompute risk from `risk.contributions` and confirm `risk ≥ threshold` (sanity check; don't trust the client blindly).
3. `to = DEMO_PHONE_NUMBER` from env; if unset/invalid → 500 with clear error.
4. If `DRY_RUN=true`: log the message that *would* be sent and return `{dryRun:true}`.
5. Else Twilio: **voice call** with inline TwiML (no public webhook needed) and **SMS**.
6. Rate limit: at most 1 alert per 2 minutes (in-memory) to prevent accidental call storms.

### Voice call TwiML (built in `twilio_service.py`)
```xml
<Response>
  <Say voice="Polly.Joanna">Automated alert from StrokeShield. A possible stroke has been detected.
  Patient {name}. Symptoms: {symptoms}. Last known well: {lkw}. Location: {address_or_"see text message"}.
  I repeat.</Say>
  <Pause length="1"/>
  <Say voice="Polly.Joanna">...same message once more...</Say>
</Response>
```
### SMS
`StrokeShield ALERT: possible stroke. Symptoms: {symptoms}. Last known well: {lkw}. Location: https://maps.google.com/?q={lat},{lng} (±{acc} m). Risk {risk:.0%}. Demo message.`

## Location
Request `navigator.geolocation` at the **consent step** (not at alert time, so the prompt doesn't block the emergency). Cache the last fix; include accuracy. If denied, the message says "location unavailable".

## Twilio gotchas
- Trial accounts: destination must be a **verified** number; calls play a trial preamble and may need a keypress. Upgrade for demo day if possible.
- SMS to US numbers from an unregistered local number can be filtered; prefer a toll-free/verified sender and test early.
- `twilio` calls are blocking — run in a threadpool or use `run_in_threadpool` so the FastAPI loop isn't stalled.

## Safety checklist (must all be true before the live demo)
- [ ] `DEMO_PHONE_NUMBER` is a teammate's number, with their consent.
- [ ] No code path can dial a request-supplied or hardcoded emergency number.
- [ ] `DRY_RUN=false` only on the demo deployment; default `true` everywhere else.
- [ ] Judges are told the call is a simulated emergency alert to a demo number.
