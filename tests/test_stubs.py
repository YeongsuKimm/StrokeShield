from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_speech_stub_asks_for_retry():
    res = client.post("/api/speech/analyze", files={"audio": ("a.wav", b"RIFF", "audio/wav")}).json()
    assert res["test"] == "speech" and res["needsRetry"] is True


def test_second_opinion_stub_is_unclear():
    body = {"images": [{"kind": "face", "jpegBase64": "AAAA"}]}
    assert client.post("/api/vision/second-opinion", json=body).json()[0]["finding"] == "unclear"
