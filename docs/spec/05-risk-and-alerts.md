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
3. `to = DEMO_PHONE_NUMBER` from env; if unset/invalid → 500 with clear error.
4. If `DRY_RUN=true`: log the message that *would* be sent and return `{dryRun:true}`.
5. Else Twilio: send **one SMS only**. The app does not create an automated voice call.
6. Rate limit: at most 1 alert per 2 minutes (in-memory) to prevent accidental call storms.

### SMS
`StrokeShield ALERT: possible stroke. Symptoms: {symptoms}. Last known well: {lkw}. Location: https://maps.google.com/?q={lat},{lng} (±{acc} m). Risk {risk:.0%}. Demo message.`

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
- [ ] Judges are told the call is a simulated emergency alert to a demo number.
