from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api")


@router.get("/agent/signed-url")
async def signed_url() -> dict[str, str]:
    # TODO (Agent dev): services.elevenlabs_service.get_signed_url() using ELEVENLABS_API_KEY + ELEVENLABS_AGENT_ID.
    raise HTTPException(status_code=501, detail="signed-url not implemented yet")
