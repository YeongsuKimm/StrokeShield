"""Speech scoring config. ALL VALUES ARE UNCALIBRATED until tuned on fixtures (docs/spec/03-speech.md).

Every number below is a first guess from the literature / spec, checked only against SYNTHETIC audio
(tests/audio_synth.py). Units are in the comment on each value.
"""

TARGET_PHRASE = "You can't teach an old dog new tricks."
# The Spanish site (docs/spec/03 "Spanish") reads this sentence; it must match frontend/src/lib/config.ts and the Spanish
# agent prompt (docs/agent-prompt.es.md) exactly.
TARGET_PHRASE_ES = "No se le pueden enseñar trucos nuevos a un perro viejo."

# Languages the speech endpoint accepts (form field `lang`). Phoneme scoring exists for English only.
LANGS = ("en", "es")
DEFAULT_LANG = "en"


def target_phrase_for(lang: str) -> str:
    """The fixed test sentence for a language (English for anything unknown)."""
    return TARGET_PHRASE_ES if lang == "es" else TARGET_PHRASE


# Syllable / word counts of the phrases we rotate through (normalized text -> syllables). Hardcoded on purpose:
# the phrase is fixed so we need no pronunciation dictionary. Unknown phrases fall back to a vowel-group heuristic.
PHRASE_SYLLABLES = {
    "you cant teach an old dog new tricks": 8,  # syllables
    "nothing beats a jolly good breakfast": 9,  # syllables
    "no se le pueden enseñar trucos nuevos a un perro viejo": 18,  # syllables: no se le pue-den en-se-ñar tru-cos nue-vos a un pe-rro vie-jo
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

# ---------------------------------------------------------------------------------------------------------
# Robustness (unknown voices, rooms and mics). UNCALIBRATED; validated only on TTS/synthetic variants
# (tests/test_speech_robustness.py). Principle: when conditions are poor or the components disagree, LOWER the severity
# or the confidence instead of reporting a confident wrong answer.
#
# Two evidence groups. QUALITY (articulation = phoneme model, voice_quality = jitter/shimmer) is what a room, a cheap or
# Bluetooth mic, an accent, a different vocal tract or a codec change most: on TTS variants of a HEALTHY sentence these two
# alone reached 0.5-0.9 (speed x1.25 0.45, other voice 0.67, reverb 0.6 s 0.54, TV in the room 0.46-0.54). TIMING (rate,
# pausing, prosody, a real transcript) survives all of those. A quality-only elevation is therefore capped unless a timing
# component agrees.
# ---------------------------------------------------------------------------------------------------------
QUALITY_COMPONENTS = ("articulation", "voice_quality")
TIMING_COMPONENTS = ("rate", "pausing", "prosody", "intelligibility")
AGREE_MIN = 0.3  # 0..1; a component at or above this is "elevated" and needs corroboration
QUALITY_NEEDS_TIMING_MIN = 0.25  # 0..1; an elevated quality component needs a timing component at or above this (reverb 1.0 s smears pitch to ~0.23)
TIMING_SUPPORT_MIN = 0.15  # 0..1; an elevated timing component needs a second timing one, or a quality one, at or above this
# Severity caps (severity units, 0..1) when the two groups do NOT agree.
QUALITY_ONLY_CAP = 0.20  # quality signals elevated, no timing component agrees
TIMING_ONLY_CAP = {"rate": 0.35, "pausing": 0.30, "prosody": 0.20, "intelligibility": 0.40}  # a lone timing signal (max over the elevated ones)
NO_SIGNAL_CAP = 0.15  # no component reaches AGREE_MIN

# Demo anchors for the only contrast we can presently support with repeatable evidence: ordinary fluent delivery versus
# an intentionally very slow, broken-up delivery. They do not claim to diagnose dysarthria. A fluent take is protected
# from microphone/accent-driven phoneme false alarms; a high result requires BOTH slow articulation and long/excessive
# pauses. Anything between these anchors keeps the normal multi-feature score. UNCALIBRATED on real patients.
DEMO_FLUENT_RATE_MIN = 2.20  # target syllables / speaking second
DEMO_FLUENT_LONGEST_PAUSE_MAX = 0.55  # s
DEMO_FLUENT_PAUSE_RATIO_MAX = 0.24  # fraction
DEMO_FLUENT_SEVERITY_CAP = 0.15
DEMO_IMPAIRED_RATE_MAX = 1.65  # intentionally slow delivery
DEMO_IMPAIRED_LONGEST_PAUSE_MIN = 0.75  # s; either this or the ratio threshold must agree
DEMO_IMPAIRED_PAUSE_RATIO_MIN = 0.32  # fraction
DEMO_IMPAIRED_SEVERITY_FLOOR = 0.85
# A second acted-demo path catches slurring without long pauses. It requires the phoneme recognizer and independent
# slowing, good SNR and no evidence of extra/background speech. Tuned only on one speaker's seven 2026-09-20 clips:
# healthy PER 0.09-0.23; acted slur PER 0.41 at 1.81 syl/s; slow+imprecise PER 0.82 at 1.58 syl/s.
DEMO_SLURRED_RATE_MAX = 1.95
DEMO_SLURRED_PER_MIN = 0.35
DEMO_SLURRED_GOP_MAX = -2.0
DEMO_SLURRED_SNR_MIN = 20.0
DEMO_SLURRED_INSERTION_MAX = 1.15
DEMO_SLURRED_SEVERITY_FLOOR = 0.85

# Spanish (lang != "en"): the phoneme model is English-only, so it is not run, and the timing ramps above were set on English
# speech (a syllable-timed language like Spanish is spoken faster, so "slow" is called even less often). To stay conservative,
# a non-English result is capped so that on its own it can never reach the result screen's caution band (speech weight 0.5 x
# severity 0.5 = 0.25 < CAUTION_RISK 0.3). It can still add to other checks through the noisy-OR. UNCALIBRATED.
NON_ENGLISH_SEVERITY_CAP = 0.5  # severity units, 0..1

# Phoneme evidence is trusted less as conditions worsen: articulation is multiplied by trust in 0..1.
PHONEME_SNR_DB = (15.0, 25.0)  # dB: trust PHONEME_TRUST_FLOOR at the low end, 1 at the high end
PHONEME_TRUST_FLOOR = 0.5  # 0..1
PHONEME_INSERTION_RATIO = 1.35  # decoded phones / target phones above this: something else was "heard" (other voices, noise)
PHONEME_INSERTION_TRUST = 0.5  # trust multiplier when the insertion ratio is above PHONEME_INSERTION_RATIO
PHONEME_BACKGROUND_RATIO = 1.6  # above this: background speech dominates -> retry "other voices" (TV on: measured 2-3x)
SYLLABLE_OVERRUN_RATIO = 1.4  # detected syllable nuclei / target syllables at or above this: more was said than the sentence (TV, chatter, a longer sentence; measured 1.5-2.1)
PHONEME_TRUSTED = 0.75  # trust below this: the phoneme scores no longer raise the confidence ceiling
PHONEME_MISMATCH = (0.75, -5.5)  # (per >=, gop_mean <=): a different sentence or no sentence, not slurring (TTS measured 0.8-1.5 / -6..-8)
PHONEME_EDGE_PHONES = 3  # this many phones at the start (or end) all near the floor while the rest is fine = that end of the sentence is missing
PHONEME_EDGE_LOGP = -5.0  # ln-posterior at or below which an edge phone counts as absent
PHONEME_EDGE_REST_LOGP = -2.5  # the remaining phones must average at least this for the "edge missing" reading
PHONEME_EDGE_TRUST = 0.5  # trust multiplier when an edge is missing (real first-run healthy clip lost "you can't": gop_min -9.9)

# Poor conditions: noisy room. Severity is capped and confidence dented (never a confident verdict).
NOISY_SNR_DB = 15.0  # dB; below this the room counts as noisy
POOR_CONDITIONS_SEVERITY_CAP = 0.35  # severity units
POOR_CONDITIONS_CONFIDENCE_FACTOR = 0.75  # multiplies confidence

MAX_ACCEPT_S = 20.0  # s, a clip longer than this is refused up front (recorder stops at 6 s; MAX_ANALYSIS_S still truncates)
PHONEME_TIMEOUT_S = 5.0  # s budget for the optional phoneme model within the 10 s endpoint budget (first call loads it)
PHONEME_LOCK_WAIT_S = 3.0  # s a second simultaneous analysis waits for the model before going DSP-only
