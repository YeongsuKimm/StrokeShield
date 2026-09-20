import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from backend import preflight, settings
from backend.routers import agent, alert, speech, vision
from backend.schemas import HealthResponse
from backend.security import (
    BodyLimitMiddleware,
    RateLimitMiddleware,
    SecurityHeadersMiddleware,
    install_log_privacy,
)

log = logging.getLogger("strokeshield.startup")
install_log_privacy()


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Configuration preflight: loud, secret-free warnings so a bad .env shows in the first log lines, not at alert time.
    try:
        for line in preflight.warnings():
            log.warning("preflight: %s", line)
    except Exception as exc:  # the preflight itself must never stop the server
        log.warning("preflight skipped (%s)", type(exc).__name__)
    # Optional heavy speech model (PyTorch wav2vec2, ~5-7 s to load): load it once at startup so the first patient's
    # request doesn't spend its 10 s budget on it. Off by default (PHONEME_SCORING=false) and never blocks startup on error.
    try:
        from models import phoneme

        if phoneme.phoneme_scoring_enabled():
            ready = await run_in_threadpool(phoneme.warmup)
            if ready:
                log.info("phoneme model warmed up")
            else:
                log.warning("phoneme model is enabled but did not warm up; speech will use timing and voice only")
    except Exception as exc:  # torch missing, model not downloaded, etc.: speech falls back to acoustic-only scoring
        log.warning("phoneme warm-up skipped (%s)", type(exc).__name__)
    yield


app = FastAPI(title="StrokeShield API", lifespan=lifespan)

# The last middleware added is the outermost: CORS (answers preflights, decorates 413/429 replies) -> security headers +
# catch-all -> body cap -> rate limit -> routes.
app.add_middleware(RateLimitMiddleware)
app.add_middleware(BodyLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins(),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],  # the browser client only ever sends Content-Type
    max_age=600,
)


@app.get("/api/health", response_model=HealthResponse, response_model_by_alias=True)
async def health() -> HealthResponse:
    return HealthResponse(ok=True, dry_run=settings.dry_run(), demo_mode=settings.demo_mode())


@app.get("/api/preflight")
async def preflight_status() -> dict[str, bool | str]:
    """Config readiness for the demo checklist. Booleans and one enum only; never a secret or the phone number."""
    return preflight.snapshot()


for r in (agent.router, alert.router, speech.router, vision.router):
    app.include_router(r)
