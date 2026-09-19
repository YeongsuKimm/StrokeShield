"""Environment access. Read at call time (not import time) so tests can monkeypatch env vars."""
import os
import re

from dotenv import load_dotenv

load_dotenv()

E164 = re.compile(r"^\+[1-9]\d{7,14}$")


def _flag(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


_FALSE_VALUES = {"0", "false", "no", "off"}


def dry_run() -> bool:
    # Fail safe: dry-run unless DRY_RUN is EXPLICITLY false/0/no/off, so a typo ("flase", "") never arms real SMS.
    return os.getenv("DRY_RUN", "true").strip().lower() not in _FALSE_VALUES


def second_opinion_enabled() -> bool:
    # Privacy kill switch, default OFF: only an explicit true/1/yes/on lets face/arm frames leave for the Gemini API.
    return _flag("SECOND_OPINION", False)


def demo_mode() -> bool:
    return _flag("DEMO_MODE", True)


def risk_threshold() -> float:
    try:
        return float(os.getenv("RISK_THRESHOLD", "0.5"))
    except ValueError:  # a malformed env value must not turn every alert into a 500
        return 0.5


def demo_phone_number() -> str | None:
    """The ONLY number the backend may ever text (SMS only). Returns None if unset/invalid."""
    num = os.getenv("DEMO_PHONE_NUMBER", "").strip()
    return num if E164.match(num) else None


def allowed_origins() -> list[str]:
    return [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
