"""Environment access. Read at call time (not import time) so tests can monkeypatch env vars."""
import os
import re

from dotenv import load_dotenv

load_dotenv()

E164 = re.compile(r"^\+[1-9]\d{7,14}$")


def _flag(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def dry_run() -> bool:
    # Default TRUE: real calls must be explicitly armed with DRY_RUN=false.
    return _flag("DRY_RUN", True)


def demo_mode() -> bool:
    return _flag("DEMO_MODE", True)


def risk_threshold() -> float:
    return float(os.getenv("RISK_THRESHOLD", "0.5"))


def demo_phone_number() -> str | None:
    """The ONLY number the backend may ever call or text. Returns None if unset/invalid."""
    num = os.getenv("DEMO_PHONE_NUMBER", "").strip()
    return num if E164.match(num) else None


def allowed_origins() -> list[str]:
    return [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
