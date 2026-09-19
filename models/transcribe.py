"""Pluggable transcriber interface for the speech test. Interface ONLY: no STT provider is implemented here.

A transcriber is any callable that takes the raw WAV bytes and returns a `Transcript`, or `None` when it
cannot (offline, timeout, API error). `models.audio.analyze_speech` treats `None` (or an exception) as
"no transcript" and degrades to acoustic-only scoring.

The future ElevenLabs Scribe implementation (`services/elevenlabs_service.py`) plugs in as, e.g.:

    def scribe_transcriber(wav_bytes: bytes) -> Transcript | None:
        ...call Scribe with word timestamps...
        return Transcript(text=..., words=[Word(w.text, w.start, w.end, w.confidence), ...])

    analyze_speech(wav_bytes, phrase, transcriber=scribe_transcriber)
"""
from collections.abc import Callable
from dataclasses import dataclass, field


@dataclass
class Word:
    text: str
    start_s: float  # seconds from the start of the WAV
    end_s: float  # seconds from the start of the WAV
    confidence: float | None = None  # 0..1 if the provider returns one


@dataclass
class Transcript:
    text: str
    words: list[Word] = field(default_factory=list)


Transcriber = Callable[[bytes], Transcript | None]
