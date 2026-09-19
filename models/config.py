"""Speech scoring config. ALL VALUES ARE UNCALIBRATED until tuned on fixtures (docs/spec/03-speech.md)."""

TARGET_PHRASE = "You can't teach an old dog new tricks."

# component -> weight (sums to 1.0)
WEIGHTS = {"intelligibility": 0.35, "rate": 0.20, "pausing": 0.15, "prosody": 0.10, "voice_quality": 0.20}

# (normal, abnormal) ramps; see backend/ramp() semantics: 0 at first value, 1 at second.
RAMPS = {
    "cer": (0.10, 0.40),
    "articulation_rate": (4.0, 2.2),  # syllables/sec, LOW is bad
    "longest_pause_s": (0.4, 1.2),
    "pause_ratio": (0.2, 0.5),
    "f0_sd_semitones": (2.5, 0.8),  # LOW is bad
    "jitter_local": (0.010, 0.035),
    "shimmer_local": (0.04, 0.10),
    "hnr_db": (18.0, 8.0),  # LOW is bad
}

# Stretch: wav2vec2 phoneme scoring (docs/spec/03-speech.md). Off unless PHONEME_SCORING=true AND torch is installed.
PHONEME_MODEL = "facebook/wav2vec2-xlsr-53-espeak-cv-ft"  # verify current model id / license before use

MIN_DURATION_S = 1.5
MIN_SNR_DB = 10.0
