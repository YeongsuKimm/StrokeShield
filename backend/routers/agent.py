from fastapi import APIRouter, HTTPException
from services.elevenlabs_service import get_signed_url

router = APIRouter(prefix="/api")


@router.get("/agent/signed-url")
async def signed_url() -> dict[str, str]:
    # Placeholder for ElevenLabs API call
    try:
        url = get_signed_url()
        return {"signedUrl": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
