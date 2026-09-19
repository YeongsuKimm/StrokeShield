from fastapi import APIRouter, File, Form, UploadFile
from fastapi.concurrency import run_in_threadpool

from backend.schemas import TestResult
from models.audio import analyze_speech
from models.config import TARGET_PHRASE

router = APIRouter(prefix="/api")


@router.post("/speech/analyze", response_model=TestResult, response_model_by_alias=True)
async def analyze(audio: UploadFile = File(...), target_phrase: str = Form(TARGET_PHRASE)) -> TestResult:
    data = await audio.read()
    return await run_in_threadpool(analyze_speech, data, target_phrase)
