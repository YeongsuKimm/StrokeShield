"""Pydantic mirror of the contracts in docs/spec/01-architecture.md and frontend/src/lib/contracts.ts.

JSON uses camelCase (to match TypeScript); Python attributes use snake_case.
Change this file, contracts.ts and the spec in the same PR.
"""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

TestName = Literal["face", "arms", "speech"]
Side = Literal["left", "right", "both", "none"]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class TestResult(CamelModel):
    test: TestName
    severity: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)
    metrics: dict[str, float] = {}
    flags: list[str] = []
    side: Side | None = None
    started_at: int
    duration_ms: int
    needs_retry: bool | None = None
    transcript: str | None = None


class VisionOpinion(CamelModel):
    kind: Literal["face", "arms"]
    finding: Literal["asymmetric", "symmetric", "unclear"]
    side: Literal["left", "right", "none"]
    confidence: float = Field(ge=0, le=1)
    rationale: str = Field(max_length=200)


class RiskContribution(CamelModel):
    test: TestName | Literal["vision"]
    weight: float
    severity: float
    confidence: float
    contribution: float


class RiskBreakdown(CamelModel):
    risk: float
    threshold: float
    contributions: list[RiskContribution]
    triggered: bool


class Patient(CamelModel):
    name: str | None = None
    age_range: str | None = None


class Location(CamelModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy_m: float | None = None


class AlertRequest(CamelModel):
    # No phone-number field on purpose; extras are forbidden so one can't be smuggled in.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    reason: Literal["risk_threshold", "user_request"]
    risk: RiskBreakdown | None = None
    patient: Patient = Patient()
    last_known_well: str | None = Field(default=None, max_length=200)
    location: Location | None = None
    symptoms: list[str] = Field(default_factory=list, max_length=20)


class AlertResponse(CamelModel):
    ok: bool
    dry_run: bool
    call_sid: str | None = None
    sms_sid: str | None = None
    error: str | None = None


class VisionImage(CamelModel):
    kind: Literal["face", "arms"]
    jpeg_base64: str


class SecondOpinionRequest(CamelModel):
    images: list[VisionImage] = Field(max_length=4)


class HealthResponse(CamelModel):
    ok: bool
    dry_run: bool
    demo_mode: bool
