from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from backend.schemas import SecondOpinionRequest, VisionOpinion
from models.vision import second_opinion

router = APIRouter(prefix="/api")


@router.post("/vision/second-opinion", response_model=list[VisionOpinion], response_model_by_alias=True)
async def vision_second_opinion(req: SecondOpinionRequest) -> list[VisionOpinion]:
    return await run_in_threadpool(second_opinion, req.images)
