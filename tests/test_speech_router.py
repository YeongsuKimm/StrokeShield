"""Speech endpoint hardening tests. The analyzer is always a monkeypatched fake: nothing depends on models.audio."""
import time

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.routers import speech
from backend.schemas import TestResult

client = TestClient(app)
URL = "/api/speech/analyze"
WAV = b"RIFF" + (1000).to_bytes(4, "little") + b"WAVE" + b"\x00" * 1000


def fake_result(**kw: object) -> TestResult:
    base: dict = dict(test="speech", severity=0.42, confidence=0.8, metrics={"cer": 0.2}, flags=["ok"], started_at=1, duration_ms=5, transcript="hi")
    return TestResult(**{**base, **kw})


@pytest.fixture
def fake_analyzer(monkeypatch):
    calls: list[tuple[int, str]] = []

    def analyze(wav: bytes, phrase: str) -> TestResult:
        calls.append((len(wav), phrase))
        return fake_result()

    monkeypatch.setattr(speech, "analyze_speech", analyze)
    return calls


def post(data: bytes = WAV, **form: str):
    return client.post(URL, files={"audio": ("a.wav", data, "audio/wav")}, data=form)


def test_normal_path_returns_result_by_alias(fake_analyzer):
    res = post(target_phrase="Hello there.")
    assert res.status_code == 200
    body = res.json()
    assert body["startedAt"] == 1 and body["durationMs"] == 5 and body["confidence"] == 0.8
    assert body["metrics"] == {"cer": 0.2} and body["transcript"] == "hi"
    assert "started_at" not in body
    assert fake_analyzer == [(len(WAV), "Hello there.")]


def test_default_phrase_when_omitted_or_blank(fake_analyzer):
    client.post(URL, files={"audio": ("a.wav", WAV, "audio/wav")})
    post(target_phrase="   ")
    assert fake_analyzer[0][1] == fake_analyzer[1][1] and fake_analyzer[0][1]


def test_oversized_upload_is_413_and_analyzer_not_called(fake_analyzer):
    res = post(b"RIFF\x00\x00\x00\x00WAVE" + b"\x00" * (speech.MAX_UPLOAD_BYTES + 10))
    assert res.status_code == 413 and "detail" in res.json()
    assert fake_analyzer == []


def test_oversized_chunked_upload_without_content_length_is_413(fake_analyzer):
    def gen():
        for _ in range(speech.MAX_UPLOAD_BYTES // 65536 + 3):
            yield b"\x00" * 65536

    res = client.post(URL, content=gen(), headers={"content-type": "multipart/form-data; boundary=x"})
    assert res.status_code == 413
    assert fake_analyzer == []


def test_garbage_bytes_give_retry_result_not_500(fake_analyzer):
    for junk in (b"", b"RIFF", b"hello this is not audio at all" * 10, b"RIFF\x00\x00\x00\x00AVI " + b"\x00" * 100):
        res = post(junk)
        assert res.status_code == 200
        body = res.json()
        assert body["test"] == "speech" and body["needsRetry"] is True
        assert body["flags"] == ["that recording wasn't usable, please try again"]
        assert body["severity"] == 0 and body["confidence"] == 0
    assert fake_analyzer == []


def test_missing_file_is_422():
    res = client.post(URL, data={"target_phrase": "x"})
    assert res.status_code == 422
    assert "audio" in str(res.json()["detail"])


def test_non_multipart_is_422():
    res = client.post(URL, json={"audio": "nope"})
    assert res.status_code == 422 and "detail" in res.json()


def test_audio_field_that_is_not_a_file_is_422():
    res = client.post(URL, data={"audio": "just text"})
    assert res.status_code == 422


def test_phrase_length_limit_is_422(fake_analyzer):
    assert post(target_phrase="x" * speech.MAX_PHRASE_CHARS).status_code == 200
    assert post(target_phrase="x" * (speech.MAX_PHRASE_CHARS + 1)).status_code == 422


def test_timeout_returns_retry_result(monkeypatch, caplog):
    def slow(wav: bytes, phrase: str) -> TestResult:
        time.sleep(0.5)
        return fake_result()

    monkeypatch.setattr(speech, "analyze_speech", slow)
    monkeypatch.setattr(speech, "ANALYZE_TIMEOUT_S", 0.05)
    with caplog.at_level("WARNING"):
        res = post()
    assert res.status_code == 200
    body = res.json()
    assert body["needsRetry"] is True and body["flags"] == ["that took too long, please try again"]
    assert any("timed out" in r.message for r in caplog.records)


def test_unexpected_exception_returns_retry_result(monkeypatch):
    def boom(wav: bytes, phrase: str) -> TestResult:
        raise RuntimeError("model exploded")

    monkeypatch.setattr(speech, "analyze_speech", boom)
    res = post()
    assert res.status_code == 200
    body = res.json()
    assert body["needsRetry"] is True and body["flags"] and "model exploded" not in str(body)


def test_logs_summary_without_phrase_or_transcript(fake_analyzer, caplog):
    with caplog.at_level("INFO"):
        post(target_phrase="a secret phrase")
    text = " ".join(r.getMessage() for r in caplog.records)
    assert "severity=0.42" in text and "secret" not in text and "transcript" not in text


def test_existing_stub_contract_still_holds():
    res = client.post(URL, files={"audio": ("a.wav", b"RIFF", "audio/wav")}).json()
    assert res["test"] == "speech" and res["needsRetry"] is True
