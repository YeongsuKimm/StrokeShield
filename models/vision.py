# OWNER: Vision dev (stretch). Spec: docs/spec/02-vision.md "Second opinion"
# TODO: call Anthropic (ANTHROPIC_MODEL) with a strict JSON-only prompt, validate to VisionOpinion,
#       return finding="unclear" on ANY failure. Must never block the session.
from backend.schemas import VisionImage, VisionOpinion


def second_opinion(images: list[VisionImage]) -> list[VisionOpinion]:
    return [
        VisionOpinion(kind=i.kind, finding="unclear", side="none", confidence=0, rationale="not implemented")
        for i in images
    ]
