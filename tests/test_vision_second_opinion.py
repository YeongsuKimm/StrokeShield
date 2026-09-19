"""Gemini second opinion: all offline, using httpx.MockTransport. A real key or network is never touched."""
import base64
import json

import httpx
import pytest

from backend.schemas import VisionImage
from models import vision
from models.vision import second_opinion

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
B64 = base64.b64encode(JPEG).decode()


def img(kind="face", data=B64):
    return VisionImage(kind=kind, jpeg_base64=data)


def reply(items, *, thought=False):
    parts = [{"text": "thinking...", "thought": True}] if thought else []
    parts.append({"text": json.dumps(items)})
    return {"candidates": [{"content": {"parts": parts}}]}


def item(index, finding="asymmetric", side="left", confidence=0.8, rationale="Left mouth corner sits lower."):
    return {"index": index, "finding": finding, "side": side, "confidence": confidence, "rationale": rationale}


class Recorder:
    """A transport that records requests and answers with `respond(request)`."""

    def __init__(self, respond):
        self.requests: list[httpx.Request] = []
        self.transport = httpx.MockTransport(lambda r: (self.requests.append(r), respond(r))[1])


def ok(payload):
    return lambda _r: httpx.Response(200, json=payload)


@pytest.fixture(autouse=True)
def key(monkeypatch):
    monkeypatch.setenv("SECOND_OPINION", "true")  # the privacy kill switch is off by default
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("GEMINI_MODEL", raising=False)


def test_without_a_key_it_is_unclear_and_never_touches_the_network(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    rec = Recorder(ok(reply([item(0)])))
    out = second_opinion([img(), img("arms")], transport=rec.transport)
    assert [o.finding for o in out] == ["unclear", "unclear"] and [o.kind for o in out] == ["face", "arms"]
    assert rec.requests == []


def test_happy_path_maps_opinions_back_by_index_and_sends_key_only_in_the_header():
    rec = Recorder(ok(reply([item(1, "symmetric", "none", 0.9, "Both arms level."), item(0)])))
    out = second_opinion([img("face"), img("arms")], transport=rec.transport)
    assert (out[0].kind, out[0].finding, out[0].side) == ("face", "asymmetric", "left")
    assert (out[1].kind, out[1].finding, out[1].side, out[1].confidence) == ("arms", "symmetric", "none", 0.9)
    (req,) = rec.requests
    assert req.headers["x-goog-api-key"] == "test-key"
    assert "test-key" not in str(req.url) and "test-key" not in req.content.decode()
    assert str(req.url).endswith("/models/gemini-3.6-flash:generateContent")
    body = json.loads(req.content)
    parts = body["contents"][0]["parts"]
    assert sum("inline_data" in p for p in parts) == 2
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    assert body["generationConfig"]["thinkingConfig"] == {"thinkingBudget": 0}


def test_prompt_never_asks_for_a_diagnosis_and_pins_the_left_right_convention():
    assert "NOT diagnosing" in vision.PROMPT and "person's left is on the RIGHT" in vision.PROMPT


def test_model_can_be_overridden_and_a_malformed_one_is_ignored(monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    rec = Recorder(ok(reply([item(0)])))
    second_opinion([img()], transport=rec.transport)
    assert str(rec.requests[0].url).endswith("/models/gemini-3.5-flash-lite:generateContent")
    # this model rejects thinkingBudget with HTTP 400 (checked live), so the field must not be sent to it
    assert "thinkingConfig" not in json.loads(rec.requests[0].content)["generationConfig"]

    monkeypatch.setenv("GEMINI_MODEL", "../../evil?x=1")
    rec = Recorder(ok(reply([item(0)])))
    second_opinion([img()], transport=rec.transport)
    assert "evil" not in str(rec.requests[0].url)


@pytest.mark.parametrize(
    "respond",
    [
        lambda _r: httpx.Response(500, text="boom"),
        lambda _r: httpx.Response(429, json={"error": {"message": "quota"}}),
        lambda _r: httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}}),
        lambda _r: httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "not json"}]}}]}),
        lambda _r: httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": '{"a": 1}'}]}}]}),
        lambda _r: (_ for _ in ()).throw(httpx.ReadTimeout("slow")),
        lambda _r: (_ for _ in ()).throw(httpx.ConnectError("down")),
    ],
)
def test_any_failure_is_unclear_never_an_exception(respond):
    out = second_opinion([img(), img("arms")], transport=Recorder(respond).transport)
    assert [o.finding for o in out] == ["unclear", "unclear"]
    assert all(o.confidence == 0 for o in out)


def test_unusable_images_are_skipped_but_good_ones_keep_their_position():
    rec = Recorder(ok(reply([item(1, "asymmetric", "right", 0.7)])))
    bad_b64 = img(data="!!!not base64!!!")
    not_jpeg = img(data=base64.b64encode(b"GIF89a" + b"\x00" * 40).decode())
    too_big = img(data=base64.b64encode(b"\xff\xd8\xff" + b"\x00" * (vision.MAX_IMAGE_BYTES + 10)).decode())
    out = second_opinion([bad_b64, img("arms"), not_jpeg, too_big], transport=rec.transport)
    assert [o.finding for o in out] == ["unclear", "asymmetric", "unclear", "unclear"]
    assert out[1].kind == "arms" and out[1].side == "right"
    assert sum("inline_data" in p for p in json.loads(rec.requests[0].content)["contents"][0]["parts"]) == 1


def test_only_bad_images_means_no_network_call():
    rec = Recorder(ok(reply([])))
    out = second_opinion([img(data="xx")], transport=rec.transport)
    assert out[0].finding == "unclear" and rec.requests == []


def test_a_data_url_prefix_is_tolerated():
    rec = Recorder(ok(reply([item(0)])))
    out = second_opinion([img(data="data:image/jpeg;base64," + B64)], transport=rec.transport)
    assert out[0].finding == "asymmetric"


def test_confidence_is_clamped_rationale_truncated_and_thought_parts_ignored():
    long = "x" * 500
    rec = Recorder(ok(reply([item(0, confidence=7, rationale=long)], thought=True)))
    (o,) = second_opinion([img()], transport=rec.transport)
    assert o.confidence == 1.0 and len(o.rationale) == 200


def test_malformed_items_do_not_poison_valid_ones_and_duplicates_or_strangers_are_ignored():
    items = [
        {"index": 0, "finding": "bogus", "side": "left", "confidence": 0.5, "rationale": "x"},
        item(1, "symmetric", "none", 0.6),
        item(1, "asymmetric", "left", 0.9),
        item(99),
        "garbage",
    ]
    out = second_opinion([img(), img("arms")], transport=Recorder(ok(reply(items))).transport)
    assert out[0].finding == "unclear"
    assert (out[1].finding, out[1].confidence) == ("symmetric", 0.6)


def test_no_images_and_the_endpoint_respect_the_contract(monkeypatch):
    assert second_opinion([]) == []
    from fastapi.testclient import TestClient

    from backend.main import app

    monkeypatch.setenv("GEMINI_API_KEY", "")
    res = TestClient(app).post("/api/vision/second-opinion", json={"images": [{"kind": "face", "jpegBase64": B64}]})
    assert res.status_code == 200
    assert res.json() == [{"kind": "face", "finding": "unclear", "side": "none", "confidence": 0.0, "rationale": "second opinion unavailable"}]


def test_off_by_default_even_with_a_key_and_makes_no_network_call(monkeypatch):
    monkeypatch.delenv("SECOND_OPINION")  # the autouse fixture turned it on; remove it entirely
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    rec = Recorder(ok(reply([item(0)])))
    out = second_opinion([img(), img("arms")], transport=rec.transport)
    assert [o.finding for o in out] == ["unclear", "unclear"] and [o.kind for o in out] == ["face", "arms"]
    assert [o.rationale for o in out] == ["second opinion is off"] * 2
    assert rec.requests == []


@pytest.mark.parametrize("value", ["false", "0", "no", "off", "", "flase", "enabled", "2"])
def test_only_explicit_truthy_values_enable_it(monkeypatch, value):
    monkeypatch.setenv("SECOND_OPINION", value)
    rec = Recorder(ok(reply([item(0)])))
    assert second_opinion([img()], transport=rec.transport)[0].rationale == "second opinion is off"
    assert rec.requests == []


@pytest.mark.parametrize("value", ["true", "1", "yes", "on", " TRUE "])
def test_truthy_values_enable_it(monkeypatch, value):
    monkeypatch.setenv("SECOND_OPINION", value)
    rec = Recorder(ok(reply([item(0)])))
    assert second_opinion([img()], transport=rec.transport)[0].finding == "asymmetric"
    assert len(rec.requests) == 1


def test_endpoint_is_off_by_default(monkeypatch):
    from fastapi.testclient import TestClient

    from backend.main import app

    monkeypatch.delenv("SECOND_OPINION")
    res = TestClient(app).post("/api/vision/second-opinion", json={"images": [{"kind": "face", "jpegBase64": B64}]})
    assert res.json()[0]["rationale"] == "second opinion is off"
