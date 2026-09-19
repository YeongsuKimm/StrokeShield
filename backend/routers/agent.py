from fastapi import APIRouter, HTTPException

from services.elevenlabs_service import (
    ElevenLabsAPIError,
    ElevenLabsConfigurationError,
    get_signed_url,
)

router = APIRouter(prefix="/api")


@router.get("/agent/signed-url")
async def signed_url() -> dict[str, str]:
    try:
        return {"signedUrl": await get_signed_url()}
    except ElevenLabsConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ElevenLabsAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
