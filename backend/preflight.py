"""Startup preflight: is the configuration consistent enough to run the demo?

Everything here is secret-free by construction: it reports booleans and short fixed strings, never a key, password,
address or phone number. `snapshot()` backs `GET /api/preflight`; `warnings()` is logged once at startup. Neither
raises: a broken environment must never stop the server from starting (the demo has a dry-run fallback).
"""
import importlib.util
import os

from backend import settings
from services import email_sms_service

_TRUE = {"1", "true", "yes", "on"}


def _phoneme_requested() -> bool:
    return os.getenv("PHONEME_SCORING", "").strip().lower() in _TRUE


def _phoneme_ready() -> bool:
    """Requested AND torch + transformers importable AND the model already cached locally. Never raises, no network."""
    if not _phoneme_requested():
        return False
    try:
        if not all(importlib.util.find_spec(m) is not None for m in ("torch", "transformers")):
            return False
        from models import phoneme

        return phoneme.model_cached()
    except Exception:
        return False


def _agent_configured() -> bool:
    return bool(os.getenv("ELEVENLABS_API_KEY", "").strip() and os.getenv("ELEVENLABS_AGENT_ID", "").strip())


def _gemini_key_present() -> bool:
    return bool(os.getenv("GEMINI_API_KEY", "").strip())


def snapshot() -> dict[str, bool | str]:
    """Booleans and one short enum only. No secrets, no phone number, no addresses."""
    return {
        "alertChannel": settings.alert_channel(),
        "dryRun": settings.dry_run(),
        "smtpConfigured": email_sms_service.smtp_config() is not None,
        "gatewayValid": settings.sms_gateway_address() is not None,
        "agentConfigured": _agent_configured(),
        "phonemeReady": _phoneme_ready(),
        "secondOpinionEnabled": settings.second_opinion_enabled() and _gemini_key_present(),
    }


def warnings() -> list[str]:
    """Human-readable, secret-free problems. Never includes a value from the environment."""
    out: list[str] = []
    channel = settings.alert_channel()
    if settings.dry_run():
        out.append("DRY_RUN is on: alerts are only logged, nothing is sent (right for development, wrong for the live demo)")
    else:
        out.append("DRY_RUN is OFF: alerts will really be sent to DEMO_PHONE_NUMBER")

    if settings.demo_phone_number() is None:
        out.append("DEMO_PHONE_NUMBER is missing or not valid E.164: every alert will be refused")
    if channel == "email_sms":
        if email_sms_service.smtp_config() is None:
            out.append("ALERT_CHANNEL=email_sms but SMTP_USER / SMTP_APP_PASSWORD are empty: a live alert will fail")
        if settings.demo_phone_number() is not None and settings.sms_gateway_address() is None:
            out.append("email-to-SMS needs a US (+1) DEMO_PHONE_NUMBER and a valid SMS_GATEWAY_DOMAIN: alerts will be refused")
    elif not all(os.getenv(k, "").strip() for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER")):
        out.append("ALERT_CHANNEL is twilio (the default) but the Twilio credentials are incomplete: a live alert will fail")

    if not _agent_configured():
        out.append("ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID missing: the voice guide is unavailable (the tests still work)")
    if _phoneme_requested() and not _phoneme_ready():
        out.append("PHONEME_SCORING is on but torch/transformers or the cached model is missing: speech uses acoustic-only scoring")
    if settings.second_opinion_enabled() and not _gemini_key_present():
        out.append("SECOND_OPINION is on but GEMINI_API_KEY is empty: the second opinion will report 'unclear'")
    return out
