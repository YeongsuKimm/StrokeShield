"""POST /api/speech/analyze: thin, defensive wrapper around models.audio.analyze_speech.

Contract: multipart `audio` (WAV) + form `target_phrase` -> TestResult (camelCase). For the patient flow this endpoint
never answers 5xx: unusable audio, timeouts and unexpected errors all come back as a normal retry-style TestResult.
Client mistakes that no retry can fix (no file, too big, phrase too long) are 4xx JSON errors.
"""
import asyncio
import logging
import time
from typing import Callable

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.routing import APIRoute

from backend.schemas import TestResult
from models.audio import analyze_speech
from models.config import TARGET_PHRASE

logger = logging.getLogger("strokeshield.speech")

MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 6 s of 16 kHz PCM16 is ~190 KB; this leaves room for other rates/formats
MULTIPART_OVERHEAD_BYTES = 64 * 1024  # boundaries + the target_phrase field
MIN_WAV_BYTES = 44  # a RIFF/WAVE header alone; anything smaller cannot be audio
MAX_PHRASE_CHARS = 200
ANALYZE_TIMEOUT_S = 10.0  # whole-endpoint budget from docs/spec/03-speech.md

FLAG_UNUSABLE = "that recording wasn't usable, please try again"
FLAG_TIMEOUT = "that took too long, please try again"
FLAG_ERROR = "something went wrong, please try again"


def _retry(flag: str, started_at: int) -> TestResult:
    """Same shape models.audio uses for a refused recording: zero severity/confidence, spoken-style reason first."""
    return TestResult(
        test="speech",
        severity=0,
        confidence=0,
        flags=[flag],
        started_at=started_at,
        duration_ms=int(time.time() * 1000) - started_at,
        needs_retry=True,
    )


def _looks_like_wav(data: bytes) -> bool:
    return len(data) >= MIN_WAV_BYTES and data[:4] == b"RIFF" and data[8:12] == b"WAVE"


class _CappedBodyRoute(APIRoute):
    """Stop reading the request body as soon as it exceeds the cap (413), before FastAPI spools it."""

    def get_route_handler(self) -> Callable:
        inner = super().get_route_handler()
        cap = MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES

        async def handler(request: Request) -> Response:
            declared = request.headers.get("content-length", "")
            if declared.isdigit() and int(declared) > cap:
                raise HTTPException(413, f"upload too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)")
            body = bytearray()
            async for chunk in request.stream():
                body += chunk
                if len(body) > cap:
                    raise HTTPException(413, f"upload too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)")
            sent = False

            async def receive() -> dict:
                nonlocal sent
                if sent:
                    return {"type": "http.disconnect"}
                sent = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}

            return await inner(Request(request.scope, receive))

        return handler


router = APIRouter(prefix="/api", route_class=_CappedBodyRoute)


@router.post("/speech/analyze", response_model=TestResult, response_model_by_alias=True)
async def analyze(
    audio: UploadFile | None = File(None),
    target_phrase: str = Form(TARGET_PHRASE, max_length=MAX_PHRASE_CHARS),
) -> TestResult:
    if audio is None:
        raise HTTPException(422, "missing audio: send multipart/form-data with a WAV file in the 'audio' field")
    t0 = time.monotonic()
    started_at = int(time.time() * 1000)

    data = await audio.read(MAX_UPLOAD_BYTES + 1)  # bounded read; the route class already capped the whole body
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"upload too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)")
    if not _looks_like_wav(data):
        logger.info("speech analyze: unusable upload (%d bytes)", len(data))
        return _retry(FLAG_UNUSABLE, started_at)

    phrase = target_phrase.strip() or TARGET_PHRASE
    try:
        result = await asyncio.wait_for(run_in_threadpool(analyze_speech, data, phrase), ANALYZE_TIMEOUT_S)
    except asyncio.TimeoutError:
        # The worker thread cannot be cancelled and finishes in the background; its result is discarded.
        logger.warning("speech analyze timed out after %.1fs (%d bytes)", ANALYZE_TIMEOUT_S, len(data))
        return _retry(FLAG_TIMEOUT, started_at)
    except Exception as exc:  # noqa: BLE001 - the patient flow must never see a bare 500
        logger.exception("speech analyze failed (%s)", type(exc).__name__)
        return _retry(FLAG_ERROR, started_at)

    logger.info(
        "speech analyze: %d bytes, %.0f ms, severity=%.2f confidence=%.2f retry=%s flags=%d",
        len(data),
        (time.monotonic() - t0) * 1000,
        result.severity,
        result.confidence,
        bool(result.needs_retry),
        len(result.flags),
    )
    return result
