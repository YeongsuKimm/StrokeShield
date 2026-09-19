# 03 — Speech (slurred speech detection)

Owner: Speech dev. Files: `frontend/src/lib/speech/recorder.ts`, `models/audio.py`, `models/config.py`, `services/elevenlabs_service.py` (STT), `backend/routers/speech.py`.
Output: a `TestResult` for `speech` plus `transcript`.

## Protocol
1. Agent says the target phrase; user repeats it. Default phrase (standard NIHSS sentence): **"You can't teach an old dog new tricks."** Keep phrases in config so we can rotate (`"Nothing beats a jolly good breakfast."`).
2. App records **up to 6 s** (auto-stop after ~1.2 s of trailing silence, min 1.5 s of audio). One retry if quality is bad.
3. During recording the **agent must be silent** and its mic muted (see 04) — otherwise it will talk over the patient or contaminate the clip.

## Capture
- Own `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })` stream (raw signal preserves voice-quality features). Wear headphones or keep the agent silent to avoid speaker bleed.
- Encode **16 kHz mono PCM16 WAV** in the browser (AudioWorklet or ScriptProcessor fallback) so the backend needs no ffmpeg. Upload as multipart to `/api/speech/analyze`.

## Pipeline (`models/audio.py`)
1. **Load & QC**: `soundfile`/`librosa` load, trim, estimate SNR from the quietest 20 % of frames; reject if duration < 1.5 s, SNR < ~10 dB, or clipping > 1 %.
2. **Transcribe**: ElevenLabs Scribe (`ELEVENLABS_STT_MODEL`, default `scribe_v1`) via `services/elevenlabs_service.py`; request word timestamps (use word confidence/logprob if the API returns it). Verify response fields against current docs.
3. **Intelligibility**: normalize text (lowercase, strip punctuation), compute **CER** and **WER** vs. target with `rapidfuzz` Levenshtein. Also fuzzy phonetic-agnostic match score.
4. **Temporal features** (from word timestamps + energy VAD):
   - `articulation_rate` — syllables/sec over speaking time (syllable count of target ÷ speaking duration; cross-check with syllable-nucleus peaks in the intensity contour, de Jong & Wempe method via Parselmouth).
   - `speech_rate_wps` — words/sec including pauses.
   - `pause_ratio` — silence ÷ total duration inside the utterance; `longest_pause_s`; `n_long_pauses` (> 0.4 s).
   - `rhythm_var` — coefficient of variation of inter-word gaps.
5. **Acoustic features** (Parselmouth/Praat, voiced frames only):
   - `f0_sd_semitones` (monotone/flat prosody), `f0_range_semitones`.
   - `jitter_local`, `shimmer_local`, `hnr_db` (breathy/strained quality).
   - `intensity_sd_db` (loudness variation), `voiced_fraction`.
   - Optional stretch: spectral tilt / MFCC delta variance for "mumbling".
6. **Score**: each feature → `ramp(x; lo, hi)` in [0,1] → weighted sum.

## Scoring config (all **uncalibrated** — tune on fixtures)
| Component | Feature(s) | Weight | Ramp (normal → abnormal) |
|---|---|---|---|
| Intelligibility | `cer` | 0.35 | 0.10 → 0.40 |
| Rate | `articulation_rate` (low is bad) | 0.20 | 4.0 → 2.2 syl/s |
| Pausing | `longest_pause_s`, `pause_ratio` | 0.15 | 0.4→1.2 s ; 0.2→0.5 |
| Prosody | `f0_sd_semitones` (low is bad) | 0.10 | 2.5 → 0.8 st |
| Voice quality | `jitter_local`, `shimmer_local`, `hnr_db` | 0.20 | 1.0%→3.5% ; 4%→10% ; 18→8 dB |

`severity = Σ weight_i · component_i`. Add flags such as `"transcript mismatch (CER 0.42)"`, `"very slow articulation"`, `"long pauses"`, `"flat pitch"`.
`confidence` = f(SNR, duration, transcript returned, voiced_fraction). If ASR fails, fall back to acoustic-only score with confidence × 0.6.

## Stretch: phoneme-level scoring (`PHONEME_SCORING=true`)
Why: modern STT auto-corrects mumbling, so transcript CER can look perfect on slurred speech. A phoneme recognizer sees what was actually articulated.
- Model: a pretrained wav2vec2 phoneme-CTC model (`models/config.py: PHONEME_MODEL`; verify the model id, license and size on Hugging Face before use). PyTorch + `transformers`, CPU, warm-loaded at server start. Optional deps live in `requirements-ml.txt` (torch CPU wheel), imported lazily.
- Fixed phrase ⇒ **hardcode the target phoneme sequence** (per phrase in config) so no espeak dependency is needed at runtime.
- Metrics: `per` (phoneme error rate from greedy CTC decode vs target, edit distance), `gop_mean` / `gop_min` (mean and worst per-phoneme log-posterior from CTC forced alignment of the target), `n_bad_phones` (< threshold), plus which phonemes failed for the flags.
- Scoring: add an `articulation` component (`ramp(per; 0.15→0.5)`, `ramp(gop_mean)`) and renormalize weights. If the flag is off or torch is missing, the pipeline silently runs without it and adds a flag `"phoneme scoring off"`.
- Budget: < 3 s on a laptop CPU for a 5 s clip; the whole endpoint still returns within 10 s. Validate on the same normal-vs-slurred fixtures as the calibration step.
- Hosting: demo laptop (backup Railway image stays torch-free).
- Not doing: training a dysarthria classifier (UA-Speech/TORGO are licensed and not stroke-specific).

## Calibration (do this at hour ~20)
- Record **5+ normal** clips from teammates (different voices/accents) and **5+ simulated slurred** clips (slow, mushy consonants, pausing — a teammate acting). Save to `tests/fixtures/audio/{normal,slurred}/`.
- Script `python -m models.calibrate` prints feature tables; adjust ramps so normal < 0.3 and slurred > 0.6. Record final values in `models/config.py`.
- Acknowledge in the pitch: simulated dysarthria ≠ real patients; this is a heuristic screen.

## Endpoint contract
`POST /api/speech/analyze` (multipart `audio`, `target_phrase`) → `TestResult` with `metrics` (all features above), `flags`, and an extra `transcript: string`. Must return within 10 s; if Scribe is slow (> 6 s), return acoustic-only result with a flag.

## Tests
- Pure-function tests for CER/WER, pause detection on synthetic signals, ramp mapping, and scoring monotonicity.
- Mock `elevenlabs_service` in tests; never call live APIs in CI.
