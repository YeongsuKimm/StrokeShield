"""Twilio SMS alerts. SAFETY: the destination is ALWAYS DEMO_PHONE_NUMBER from env (see AGENTS.md rule 1)."""
import logging
import os
import time

from backend import settings
from backend.schemas import AlertRequest, AlertResponse

log = logging.getLogger("alert")

MIN_SECONDS_BETWEEN_ALERTS = 120
_last_alert_at: float | None = None


def build_message(req: AlertRequest) -> str:
    symptoms = "; ".join(req.symptoms) or "not specified"
    parts = [f"StrokeShield ALERT: possible stroke. Symptoms: {symptoms}."]
    if req.patient.name:
        parts.append(f"Patient: {req.patient.name}.")
    parts.append(f"Last known well: {req.last_known_well or 'unknown'}.")
    if req.location:
        acc = f" (±{round(req.location.accuracy_m)} m)" if req.location.accuracy_m else ""
        parts.append(f"Location: https://maps.google.com/?q={req.location.lat},{req.location.lng}{acc}.")
    else:
        parts.append("Location unavailable.")
    if req.risk:
        parts.append(f"Risk {req.risk.risk:.0%}.")
    parts.append("Demo message.")
    return " ".join(parts)


def risk_confirmed(req: AlertRequest) -> bool:
    """Server-side sanity check: recompute noisy-OR from the client's contributions vs OUR threshold."""
    if req.reason == "user_request":
        return True
    if not req.risk:
        return False
    remaining = 1.0
    for c in req.risk.contributions:
        remaining *= 1 - min(max(c.contribution, 0.0), 1.0)
    return (1 - remaining) >= settings.risk_threshold()


def place_alert(req: AlertRequest) -> AlertResponse:
    """Blocking. Call from a threadpool."""
    global _last_alert_at

    to = settings.demo_phone_number()
    if to is None:
        return AlertResponse(ok=False, dry_run=settings.dry_run(), error="DEMO_PHONE_NUMBER is not set or not valid E.164")
    if not risk_confirmed(req):
        return AlertResponse(ok=False, dry_run=settings.dry_run(), error="risk below threshold; alert refused")

    message = build_message(req)

    if settings.dry_run():
        log.info("DRY RUN alert (nothing sent). SMS text: %s", message)
        return AlertResponse(ok=True, dry_run=True)

    now = time.monotonic()
    if _last_alert_at is not None and now - _last_alert_at < MIN_SECONDS_BETWEEN_ALERTS:
        return AlertResponse(ok=False, dry_run=False, error="rate limited: an alert was sent in the last 2 minutes")

    sid, token, sender = (os.getenv(k) for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"))
    if not (sid and token and sender):
        return AlertResponse(ok=False, dry_run=False, error="Twilio credentials are not configured")

    from twilio.rest import Client  # imported lazily so tests/dry-run don't need credentials

    client = Client(sid, token)
    try:
        sms = client.messages.create(to=to, from_=sender, body=message)
    except Exception as exc:  # surface Twilio errors (e.g. unverified trial number) to the UI
        log.exception("Twilio alert failed")
        return AlertResponse(ok=False, dry_run=False, error=f"Twilio error: {exc}")

    _last_alert_at = now
    return AlertResponse(ok=True, dry_run=False, sms_sid=sms.sid)
