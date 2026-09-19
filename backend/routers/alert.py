from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from backend.schemas import AlertRequest, AlertResponse
from services.twilio_service import place_alert

router = APIRouter(prefix="/api")


@router.post("/alert", response_model=AlertResponse, response_model_by_alias=True)
async def alert(req: AlertRequest) -> AlertResponse:
    return await run_in_threadpool(place_alert, req)
