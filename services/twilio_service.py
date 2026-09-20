"""Alert delivery (email-to-SMS by default here, or Twilio SMS). SAFETY: the destination is ALWAYS derived from
DEMO_PHONE_NUMBER in the environment (see AGENTS.md rule 1); nothing in a request can choose it."""
import logging
import os
import smtplib
import threading
import time

from backend import settings
from backend.schemas import AlertRequest, AlertResponse
from services import email_sms_service

log = logging.getLogger("alert")

MIN_SECONDS_BETWEEN_ALERTS = 120
_last_alert_at: float | None = None
_send_lock = threading.Lock()  # serialises live sends so a double-fired alert cannot slip past the rate limit
MAX_FIELD_CHARS = 120  # SMS bodies are built from client text; keep each free-text field short


def _clip(text: str) -> str:
    return text if len(text) <= MAX_FIELD_CHARS else text[: MAX_FIELD_CHARS - 1] + "\u2026"


def build_message(req: AlertRequest) -> str:
    symptoms = "; ".join(_clip(x) for x in req.symptoms) or "not specified"
    parts = [f"StrokeShield ALERT: possible stroke. Symptoms: {symptoms}."]
    parts.append(f"Last known well: {_clip(req.last_known_well) if req.last_known_well else 'unknown'}.")
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

    if not settings.alert_channel_valid():
        return AlertResponse(ok=False, dry_run=settings.dry_run(), error="ALERT_CHANNEL is invalid; alert refused")

    to = settings.demo_phone_number()
    if to is None:
        return AlertResponse(ok=False, dry_run=settings.dry_run(), error="DEMO_PHONE_NUMBER is not set or not valid E.164")
    if not risk_confirmed(req):
        return AlertResponse(ok=False, dry_run=settings.dry_run(), error="risk below threshold; alert refused")

    if settings.alert_channel() == "email_sms":
        return _place_email_sms(req)

    message = build_message(req)

    if settings.dry_run():
        log.info("DRY RUN alert (nothing sent), SMS would be %d chars", len(message))  # no PII (name/location) in logs
        return AlertResponse(ok=True, dry_run=True)

    sid, token, sender = (os.getenv(k) for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"))
    if not (sid and token and sender):
        return AlertResponse(ok=False, dry_run=False, error="Twilio credentials are not configured")

    with _send_lock:
        now = time.monotonic()
        if _last_alert_at is not None and now - _last_alert_at < MIN_SECONDS_BETWEEN_ALERTS:
            return AlertResponse(ok=False, dry_run=False, error="rate limited: an alert was sent in the last 2 minutes")
        try:
            from twilio.rest import (
                Client,  # imported lazily so tests/dry-run don't need credentials
            )

            sms = Client(sid, token).messages.create(to=to, from_=sender, body=message)
        except Exception as exc:  # never show Twilio's raw message (can echo numbers / the account SID) to the browser
            code = getattr(exc, "code", None)
            log.error("Twilio alert failed (%s, code=%s)", type(exc).__name__, code)
            detail = f" (Twilio error {code})" if code else ""
            return AlertResponse(ok=False, dry_run=False, error=f"SMS could not be sent{detail}")
        _last_alert_at = now
    return AlertResponse(ok=True, dry_run=False, sms_sid=sms.sid)


def _place_email_sms(req: AlertRequest) -> AlertResponse:
    """Email-to-SMS delivery: same guards as the Twilio path (env-only destination, DRY_RUN, one alert per 2 minutes)."""
    global _last_alert_at

    to = settings.sms_gateway_address()
    if to is None:
        return AlertResponse(ok=False, dry_run=settings.dry_run(), error="email-to-SMS needs a US DEMO_PHONE_NUMBER and a valid SMS_GATEWAY_DOMAIN")
    message = email_sms_service.build_short_message(req)

    if settings.dry_run():
        log.info("DRY RUN alert (nothing sent), email-to-SMS would be %d chars", len(message))  # no PII in logs
        return AlertResponse(ok=True, dry_run=True)

    if email_sms_service.smtp_config() is None:
        return AlertResponse(ok=False, dry_run=False, error="email-to-SMS is not configured (SMTP_USER / SMTP_APP_PASSWORD)")

    with _send_lock:
        now = time.monotonic()
        if _last_alert_at is not None and now - _last_alert_at < MIN_SECONDS_BETWEEN_ALERTS:
            return AlertResponse(ok=False, dry_run=False, error="rate limited: an alert was sent in the last 2 minutes")
        try:
            email_sms_service.send(to, message)
        except Exception as exc:  # never show SMTP's raw text (it can echo the account or address) to the browser
            log.error("email-to-SMS alert failed (%s)", type(exc).__name__)
            login = " (email login failed: check SMTP_USER and the app password)" if isinstance(exc, smtplib.SMTPAuthenticationError) else ""
            return AlertResponse(ok=False, dry_run=False, error=f"Alert could not be sent{login}")
        _last_alert_at = now
    return AlertResponse(ok=True, dry_run=False)
