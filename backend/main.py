from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend import settings
from backend.routers import agent, alert, speech, vision
from backend.schemas import HealthResponse

app = FastAPI(title="StrokeShield API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins(),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/health", response_model=HealthResponse, response_model_by_alias=True)
async def health() -> HealthResponse:
    return HealthResponse(ok=True, dry_run=settings.dry_run(), demo_mode=settings.demo_mode())


for r in (agent.router, alert.router, speech.router, vision.router):
    app.include_router(r)
