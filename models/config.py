"""Speech scoring config. ALL VALUES ARE UNCALIBRATED until tuned on fixtures (docs/spec/03-speech.md).

Every number below is a first guess from the literature / spec, checked only against SYNTHETIC audio
(tests/audio_synth.py). Units are in the comment on each value.
"""

TARGET_PHRASE = "You can't teach an old dog new tricks."

# Syllable / word counts of the phrases we rotate through (normalized text -> syllables). Hardcoded on purpose:
# the phrase is fixed so we need no pronunciation dictionary. Unknown phrases fall back to a vowel-group heuristic.
PHRASE_SYLLABLES = {
    "you cant teach an old dog new tricks": 8,  # syllables
    "nothing beats a jolly good breakfast": 9,  # syllables
}

# ---------------------------------------------------------------------------------------------------------
# Scoring: component -> weight. Components missing from a given run (no transcript, no phoneme scores, no
# usable pitch) are dropped and the remaining weights renormalized, so severity stays on the same 0..1 scale.
# ---------------------------------------------------------------------------------------------------------
WEIGHTS = {
    "intelligibility": 0.35,  # CER vs target (or PER proxy if no transcript); only if transcript or phoneme scores exist
    "articulation": 0.25,  # phoneme-level PER + GOP; only if phoneme scores exist (agent B's models/phoneme.py)
    "rate": 0.20,  # articulation_rate
    "pausing": 0.15,  # longest_pause_s + pause_ratio
    "prosody": 0.10,  # f0_sd_semitones
    "voice_quality": 0.20,  # jitter RAP + shimmer APQ3 (running-speech HNR is reported, not scored)
}  # unitless weights; renormalized over available components (they need not sum to 1 here)

# (normal, abnormal) ramps; ramp() semantics: 0 at first value, 1 at second, linear between, clamped. Works when hi < lo.
RAMPS = {
    "cer": (0.10, 0.40),  # character error rate, 0..1
    "per": (0.25, 0.60),  # phoneme error rate, 0..1 (articulation component). Spec start was 0.15->0.50, but the real model gives 0.09-0.28 on CORRECT TTS speech, so normal speakers must not be penalised
    "gop_mean": (-1.5, -4.5),  # mean per-phone ln-posterior in [-10, 0] (models/phoneme.py), LOW is bad; correct TTS speech measured -0.7..-1.5, mumbled -5..-6
    "articulation_rate": (2.6, 1.5),  # syllables/sec, LOW is bad; first real healthy fixed-phrase run measured 2.64
    "longest_pause_s": (0.4, 1.2),  # seconds
    "pause_ratio": (0.2, 0.5),  # fraction of utterance
    "f0_sd_semitones": (2.0, 0.8),  # semitones, LOW is bad; first real healthy fixed-phrase run measured 1.91
    # Jitter/shimmer: the spec's LOCAL variants (1.0->3.5 %, 4->10 %) are sustained-vowel norms. On RUNNING speech, intonation
    # and loudness movement inflate local jitter/shimmer to ~0.9 % / ~9 % even for a perfectly steady voice (measured on
    # synthetic audio), so we SCORE the slope-tolerant RAP / APQ3 variants (3-point smoothed; ~0.57x local in the
    # synthetic sweep) and only REPORT local. Ramps below are the spec's, scaled by ~0.6.
    "jitter_rap": (0.006, 0.021),  # fraction (0.6 % -> 2.1 %)
    "shimmer_apq3": (0.022, 0.056),  # fraction (2.2 % -> 5.6 %)
    "hnr_db": (18.0, 8.0),  # dB, reported only: running-speech HNR false-alarmed on the first clean real-mic run
}

# The weighted sum of components (0..1) is itself mapped through this ramp before it is reported as severity.
# Reason: real impaired speakers rarely saturate EVERY component, so a plain weighted sum would top out near 0.5
# and could never reach the shared "clear deficit >= 0.85" anchor; and healthy people always carry a little
# residual (accents, mic noise). (lo, hi): weighted sum <= lo -> severity 0, >= hi -> severity 1.
SEVERITY_MAP = (0.10, 0.60)  # weighted-sum units (0..1)

# Stretch: wav2vec2 phoneme scoring (docs/spec/03-speech.md). Off unless PHONEME_SCORING=true AND torch is installed.
PHONEME_MODEL = "mostafaashahin/wav2vec2-base-timit-phoneme-arpa-39"  # 378 MB, ARPAbet-39; no declared licence (base model Apache-2.0). Override with env PHONEME_MODEL_ID. Real model id lives in models/phoneme.py

# ---------------------------------------------------------------------------------------------------------
# Quality gates (QC). Failing any of these -> needs_retry with a spoken-style reason.
# ---------------------------------------------------------------------------------------------------------
SAMPLE_RATE = 16000  # Hz, analysis rate (the browser recorder sends 16 kHz mono PCM16)
MAX_ANALYSIS_S = 12.0  # s, longer audio is truncated (recorder stops at ~6 s; protects the 10 s endpoint budget)
MIN_DURATION_S = 1.5  # s, raw clip length
MIN_SPEECH_S = 0.8  # s, trimmed utterance (first to last speech frame); shorter -> "didn't hear enough speech"
MIN_SNR_DB = 10.0  # dB, speech vs quietest-20%-frames
MAX_CLIPPED_FRACTION = 0.01  # fraction of samples at |x| >= CLIP_LEVEL
CLIP_LEVEL = 0.999  # full-scale fraction
MIN_SPEECH_DBFS = -50.0  # dBFS, RMS of the loud frames; quieter -> "too quiet"

# Shared with the frontend: mirrors frontend/src/lib/config.ts MIN_CONFIDENCE. Change both together.
MIN_CONFIDENCE = 0.3  # 0..1; below this a result is a retry
RETRY_CONFIDENCE = MIN_CONFIDENCE * 0.99  # confidence reported on retries: just under the cutoff (as face/arms/eyes do)

# Confidence = component ceiling * quality. Ceilings by which evidence exists (spec: acoustic-only <= ~0.6).
CONFIDENCE_CEILING = {
    "acoustic": 0.6,  # 0..1, acoustic features only
    "one_extra": 0.85,  # 0..1, plus transcript OR phoneme scores
    "both_extra": 1.0,  # 0..1, plus transcript AND phoneme scores
}
CONFIDENCE_SNR_DB = (MIN_SNR_DB, 25.0)  # dB, quality 0 at the gate, 1 at 25 dB
CONFIDENCE_SPEECH_S = (MIN_SPEECH_S, 2.0)  # s, trimmed speech duration
CONFIDENCE_VOICED_FRACTION = (0.05, 0.35)  # fraction of utterance frames with a pitch
CONFIDENCE_QUALITY_FLOOR = 0.4  # each quality term is floor + (1-floor)*ramp, so one weak term dents but doesn't zero it

# ---------------------------------------------------------------------------------------------------------
# Feature extraction
# ---------------------------------------------------------------------------------------------------------
FRAME_S = 0.025  # s, energy frame length
HOP_S = 0.010  # s, energy hop
VAD_MIN_MARGIN_DB = 8.0  # dB above noise floor at minimum
VAD_MARGIN_FRACTION = 0.30  # fraction of (loud - noise) dB range used as the speech threshold
VAD_NOISE_FLOOR_MIN_DB = -75.0  # dBFS, noise floor never assumed lower than this (digital silence)
MIN_PAUSE_S = 0.20  # s, silences shorter than this are stop closures / articulation, not pauses
MIN_SEGMENT_S = 0.05  # s, speech bursts shorter than this are dropped as clicks
LONG_PAUSE_S = 0.40  # s, n_long_pauses counts pauses above this
TRIM_PAD_S = 0.10  # s, context kept around the utterance when trimming

PITCH_FLOOR_HZ = 70.0  # Hz
PITCH_CEILING_HZ = 400.0  # Hz
PITCH_TIME_STEP_S = 0.01  # s
MIN_VOICED_FRAMES = 20  # frames (0.2 s) needed before pitch/voice-quality metrics are trusted
F0_OUTLIER_SEMITONES = 10.0  # st from the median; beyond this is treated as an octave/tracking error
JITTER_MIN_VOICED_FRAMES = 30  # frames (0.3 s)

NUCLEUS_PEAK_BELOW_MAX_DB = 25.0  # dB below the intensity maximum a syllable peak must reach (de Jong & Wempe)
NUCLEUS_MIN_DIP_DB = 2.0  # dB minimum dip between consecutive peaks (de Jong & Wempe)
NUCLEUS_MIN_PITCH_HZ = 75.0  # Hz, intensity smoothing setting for the nucleus contour
NUCLEUS_RATIO_OK = (0.6, 1.5)  # nuclei / target-syllables inside this band -> trust the target's syllable count

TRANSCRIBE_TIMEOUT_S = 6.0  # s, spec: if the transcriber is slower than this, go acoustic-only

FLAG_MIN_COMPONENT = 0.4  # 0..1; a component at or above this adds a human-readable flag ("long pauses", ...)
