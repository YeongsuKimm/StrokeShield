from typing import Literal

from fastapi import APIRouter, HTTPException

from services.elevenlabs_service import (
    ElevenLabsAPIError,
    ElevenLabsConfigurationError,
    get_signed_url,
)

router = APIRouter(prefix="/api")


@router.get("/agent/signed-url")
async def signed_url(lang: Literal["en", "es"] = "en") -> dict[str, str]:
    """A signed URL for the voice agent in the site's language (Spanish uses its own agent)."""
    try:
        return {"signedUrl": await get_signed_url(lang)}
    except ElevenLabsConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ElevenLabsAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
