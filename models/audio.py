# OWNER: Speech dev. Spec: docs/spec/03-speech.md
# TODO: QC -> Scribe transcript -> CER/WER -> temporal + Parselmouth features -> weighted severity.
# Keep feature/scoring functions pure so pytest can run them on synthetic signals.
import time

from backend.schemas import TestResult


def analyze_speech(wav_bytes: bytes, target_phrase: str) -> TestResult:
    _ = (wav_bytes, target_phrase)
    return TestResult(
        test="speech",
        severity=0,
        confidence=0,
        flags=["speech analysis not implemented"],
        started_at=int(time.time() * 1000),
        duration_ms=0,
        needs_retry=True,
    )
