# OWNER: Vision dev (stretch). Spec: docs/spec/02-vision.md "Second opinion"
"""AI second opinion on still frames, via the Gemini API (free tier is enough; no paid API).

The result is a soft signal only: it is folded into the risk score with a small weight and shown as "AI second opinion".
It must NEVER block or break a session, so every failure path (switched off via SECOND_OPINION, no key, bad image, network, timeout, safety block,
malformed JSON) returns `finding="unclear"` instead of raising. No image data, key or response text is logged.
"""
import base64
import binascii
import json
import logging
import os
import re

import httpx

from backend import settings
from backend.schemas import VisionImage, VisionOpinion

log = logging.getLogger("vision")

API_ROOT = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_MODEL = "gemini-2.5-flash"  # on the free tier; override with GEMINI_MODEL (e.g. a newer Flash)
TIMEOUT_S = 5.0  # spec 01: the session proceeds without it after 5 s
MAX_IMAGE_BYTES = 1_500_000  # the client sends <= 512 px JPEGs (~50 KB); anything this big is not ours
_MODEL_ID = re.compile(r"^[A-Za-z0-9._-]+$")

PROMPT = (
    "You are a careful visual observer for a stroke-awareness demo. You are NOT diagnosing anything and must not "
    "speculate about causes. For each numbered image, describe only OBSERVABLE asymmetry. "
    "For a 'face' image (the person was asked to smile): does one side of the mouth or face droop or lift less than "
    "the other? For an 'arms' image (both arms held straight out): is one arm clearly lower than the other? "
    "Sides are the PERSON's own left and right. The image is an unmirrored camera frame, so the person's left is on the "
    "RIGHT of the picture. "
    "finding: 'asymmetric' only when the asymmetry is clear; 'symmetric' when none is visible; 'unclear' when the face "
    "or both arms are not clearly visible, or the image is too dark or blurry. "
    "side: the weaker or lower side, or 'none'. "
    "confidence: 0 to 1 and honest (0.5 or less when unsure). "
    "rationale: one plain sentence under 150 characters describing only what is visible. "
    "Return a JSON array with exactly one object per image; 'index' is the image number."
)

_RESPONSE_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "index": {"type": "INTEGER"},
            "finding": {"type": "STRING", "enum": ["asymmetric", "symmetric", "unclear"]},
            "side": {"type": "STRING", "enum": ["left", "right", "none"]},
            "confidence": {"type": "NUMBER"},
            "rationale": {"type": "STRING"},
        },
        "required": ["index", "finding", "side", "confidence", "rationale"],
    },
}


def _unclear(kind: str, why: str) -> VisionOpinion:
    return VisionOpinion(kind=kind, finding="unclear", side="none", confidence=0, rationale=why)


def _decode_jpeg(image: VisionImage) -> bytes | None:
    """The raw JPEG bytes, or None if this is not a plausible, reasonably sized JPEG."""
    data = image.jpeg_base64.split(",", 1)[-1]  # tolerate a data: URL prefix
    if len(data) > MAX_IMAGE_BYTES * 4 // 3 + 8:
        return None
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        return None
    return raw if 0 < len(raw) <= MAX_IMAGE_BYTES and raw[:3] == b"\xff\xd8\xff" else None


def build_request(model: str, frames: list[tuple[int, str, bytes]]) -> dict:
    """The generateContent body for `frames` = [(index, kind, jpeg_bytes)]."""
    parts: list[dict] = [{"text": PROMPT}]
    for index, kind, raw in frames:
        parts.append({"text": f"Image {index} ({kind}):"})
        parts.append({"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(raw).decode("ascii")}})
    config: dict = {
        "temperature": 0,
        "maxOutputTokens": 1024,
        "responseMimeType": "application/json",
        "responseSchema": _RESPONSE_SCHEMA,
    }
    if model.startswith("gemini-2.5-flash"):
        config["thinkingConfig"] = {"thinkingBudget": 0}  # answer directly: thinking only adds latency here
    return {"contents": [{"role": "user", "parts": parts}], "generationConfig": config}


def parse_response(payload: dict, kinds: dict[int, str]) -> dict[int, VisionOpinion]:
    """Opinions by image index from a generateContent response. Malformed items are skipped (caller fills `unclear`)."""
    parts = payload["candidates"][0]["content"]["parts"]
    text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
    items = json.loads(text)
    out: dict[int, VisionOpinion] = {}
    if not isinstance(items, list):
        return out
    for item in items:
        try:
            index = int(item["index"])
            if index not in kinds or index in out:
                continue
            out[index] = VisionOpinion(
                kind=kinds[index],
                finding=item["finding"],
                side=item["side"],
                confidence=min(1.0, max(0.0, float(item["confidence"]))),
                rationale=str(item["rationale"]).strip()[:200],
            )
        except (KeyError, TypeError, ValueError):
            continue
    return out


def second_opinion(images: list[VisionImage], *, transport: httpx.BaseTransport | None = None) -> list[VisionOpinion]:
    """One opinion per input image, same order. Never raises."""
    results = [_unclear(i.kind, "second opinion unavailable") for i in images]
    if not images:
        return results
    if not settings.second_opinion_enabled():  # privacy kill switch (default off): no decoding, no network
        return [_unclear(i.kind, "second opinion is off") for i in images]
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        return results

    frames: list[tuple[int, str, bytes]] = []
    for n, image in enumerate(images):
        raw = _decode_jpeg(image)
        if raw is None:
            results[n] = _unclear(image.kind, "image could not be used")
        else:
            frames.append((n, image.kind, raw))
    if not frames:
        return results

    model = os.getenv("GEMINI_MODEL", "").strip() or DEFAULT_MODEL
    if not _MODEL_ID.match(model):
        log.warning("[vision] ignoring malformed GEMINI_MODEL, using %s", DEFAULT_MODEL)
        model = DEFAULT_MODEL
    try:
        with httpx.Client(timeout=TIMEOUT_S, transport=transport) as client:
            res = client.post(
                f"{API_ROOT}/models/{model}:generateContent",
                headers={"x-goog-api-key": key},
                json=build_request(model, frames),
            )
            res.raise_for_status()
        parsed = parse_response(res.json(), {n: kind for n, kind, _ in frames})
    except httpx.HTTPStatusError as e:
        log.warning("[vision] gemini returned HTTP %s", e.response.status_code)  # no body: it can echo the request
        return results
    except Exception as e:  # noqa: BLE001 - a second opinion must never break the session
        log.warning("[vision] gemini call failed: %s", type(e).__name__)
        return results
    for n, opinion in parsed.items():
        results[n] = opinion
    return results
