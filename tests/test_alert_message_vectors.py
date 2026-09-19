"""Golden vectors for the alert text. The SAME file is read by frontend/src/lib/alertPreview.test.ts, so the
on-screen preview (a TypeScript mirror of build_short_message) cannot drift from what the phone receives.
Change the builder or the vectors and both suites must agree; regenerate expectedText from this Python builder."""
import json
from pathlib import Path

import pytest

from backend.schemas import AlertRequest
from services.email_sms_service import MAX_SMS_CHARS, build_short_message

VECTORS = json.loads((Path(__file__).parent / "fixtures" / "alert_message_vectors.json").read_text(encoding="utf-8"))


def test_vectors_file_is_not_empty_and_names_are_unique() -> None:
    names = [v["name"] for v in VECTORS]
    assert len(names) >= 20
    assert len(set(names)) == len(names)


@pytest.mark.parametrize("vector", VECTORS, ids=[v["name"] for v in VECTORS])
def test_builder_matches_golden_vector(vector: dict) -> None:
    text = build_short_message(AlertRequest.model_validate(vector["request"]))
    assert text == vector["expectedText"]
    assert len(text) <= MAX_SMS_CHARS
    assert "\n" not in text and "\r" not in text
