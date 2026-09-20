# Browser start rule

The browser speech recorder starts only from the user's explicit **Start recording** button click. The ElevenLabs
`start_speech_test` client tool waits for the result of that button-started run; it never opens the microphone or
starts recording by itself. This prevents the agent's voice from becoming the speech-test sample.
# 03 — Speech (slurred speech detection)

Owner: Speech dev. Files: `frontend/src/lib/speech/recorder.ts`, `models/audio.py`, `models/config.py`, `services/elevenlabs_service.py` (STT), `backend/routers/speech.py`.
Output: a `TestResult` for `speech` plus `transcript`.

## As built (read this first; differences from the plan below are deliberate)
Code: `models/audio.py` (orchestrator `analyze_speech(wav_bytes, target_phrase, transcriber=None)`), `models/speech_features.py` (pure DSP), `models/transcribe.py` (interface only), `models/phoneme.py` (optional PyTorch), `models/config.py` (all ramps/weights/gates, UNCALIBRATED), `models/calibrate.py` (CLI), `backend/routers/speech.py`; browser `frontend/src/lib/speech/*`, `SpeechPanel`, `SpeechRecordPanel` (isolated at `?record=speech`; legacy `?record=1` shows both recorder panels). ElevenLabs is ON HOLD: the transcript is a pluggable `Transcriber = Callable[[bytes], Transcript | None]`; with none, intelligibility (CER) is simply absent and the weights renormalize over what is available.
- **Components and weights** (renormalized over those present): intelligibility 0.35 (**only from a real transcript**; PER is NOT reused as a proxy, to avoid counting one signal twice), articulation 0.25 (phoneme scores, only if PyTorch enabled), rate 0.20, pausing 0.15, prosody 0.10, voice quality 0.20. Severity = `SEVERITY_MAP (0.10, 0.60)` applied to the weighted sum (a plain weighted sum can't reach the shared ≥ 0.85 anchor because real impaired speakers don't saturate every component).
- **Voice quality scores RAP and APQ3, not local jitter/shimmer or HNR**: running-speech pitch/loudness movement inflates local jitter/shimmer, while natural consonants/unvoiced intervals depressed whole-utterance HNR to 8.97 dB in the first clean real-mic run and caused a false alarm. All three excluded metrics remain reported.
- **QC gates and retry reasons** (spoken-style `flags[0]`): raw clip < 1.5 s "too short, please say the whole sentence"; loud frames < −50 dBFS "too quiet, please speak louder"; ≥ 1 % clipped "too loud, please move back from the microphone"; SNR < 10 dB "too much background noise"; trimmed speech < 0.8 s; undecodable / any exception. The browser also refuses to upload unusable clips (too quiet / too loud / silent) and records only ~0.5 s of trailing silence.
- **Confidence** = ceiling × quality: ceiling 0.6 acoustic-only, 0.85 with a transcript or phoneme scores, 1.0 with both; quality = geometric mean of SNR, speech duration, voiced fraction (each floored at 0.4). Below `MIN_CONFIDENCE` (0.3) → retry. Consequence: acoustic-only speech contributes at most 0.6 × 0.5 = 0.3 to the risk score and can never alert on its own.
- **Phoneme scoring** (`PHONEME_SCORING=true`, laptop only): model `mostafaashahin/wav2vec2-base-timit-phoneme-arpa-39` (378 MB, ARPAbet-39, base wav2vec2 fine-tuned on TIMIT; **no declared licence** — base model is Apache-2.0, TIMIT is LDC-licensed: fine for a demo, credit it). Install: `pip install -r requirements-ml.txt` then `python -m models.phoneme --download` once (caches in `~/.cache/huggingface`; runtime never touches the network). Targets are hardcoded per phrase (3 phrases). Warm ≈ 0.4–0.9 s for a 5 s clip, load 5–7 s, ~1.35 GB RAM while scoring; `backend/main.py` warms it at startup when enabled. Ramps: `per` 0.25→0.60 and `gop_mean` −1.5→−4.5 (measured: correct TTS speech per 0.09–0.28, gop −0.7…−1.5; wrong phrase per ≈ 1; mumble gop −5…−6). Scores are nearly binary (a phoneme is present or not) so severity is steppy. It catches mis-articulation, NOT slowness or pauses (the DSP features do).
- **Endpoint limits** (`backend/routers/speech.py`): 5 MB upload cap (413), header duration > 20 s refused (retry), missing/non-multipart audio 422, `target_phrase` ≤ 200 chars, non-WAV or < 44 bytes → normal 200 retry result, 10 s budget (timeout → retry result "that took too long, please try again"), unexpected exception → retry result; never a bare 5xx in the patient flow.
- **Verified so far (synthetic + TTS only, NO real human recordings):** healthy synthetic ≤ 0.06 across 96 variants; borderline 0.35; impaired 1.0; TTS pipeline run: clean 0.16, slowed 0.94, two 1 s pauses 0.69, 10 dB noise 0.32. Expect real speech to be much less separable, and noisy rooms / accents / cheap mics to raise severity. **Nothing here is validated until the team records real clips (see Calibration).**
- **Plugging in ElevenLabs Scribe later:** write `def scribe(wav_bytes) -> Transcript | None` in `services/elevenlabs_service.py` (words with start/end/confidence), pass it as `analyze_speech(wav, phrase, transcriber=scribe)` (one small edit in the router). It runs in a worker thread with a 6 s timeout; failure degrades to acoustic-only with the flag "transcript unavailable"; success adds `cer`, `wer`, `text_match` and `TestResult.transcript`.

## Robustness for unknown voices, rooms and mics (as built)
Goal: a healthy person in a bad room, on a cheap mic, with an accent or a word slip must not be flagged. Numbers below are from TTS renders of the sentence (facebook/mms-tts-eng) and synthetic audio pushed through `tests/audio_variants.py`; **no real human recordings beyond one healthy clip**. All thresholds are in `models/config.py` (section "Robustness"), UNCALIBRATED.
- **Finding (phoneme ON, healthy TTS sentence):** clean 0.00-0.01, but the phoneme + jitter/shimmer pair alone produced: speed x1.25/x1.4 0.45, slow x0.8 0.49, other vocal tract (+/-13-15 %) 0.56-0.67, pitch -4 st 0.73, accent-like drift 0.75, reverb RT60 0.6/1.0 s 0.54/0.71, TV at 6-20 dB 0.29-0.54, other sentence 0.46-0.58, end cut off 0.26. Per (0.14 clean) rose to 0.41-0.59 and gop_mean fell to -2.4..-4.3 for all of those; noise, soft voice, laptop/Bluetooth-mic band-limits and 44.1/48 kHz devices were harmless (<= 0.06). The real healthy laptop-mic clip (owner, first take) scored 0.00 but lost its first three phones (gop_min -9.9): a late mic start, not slurring.
- **Agreement rule** (`severity_cap`): components are QUALITY (articulation, voice_quality) or TIMING (rate, pausing, prosody, intelligibility). An elevated (>= 0.3) quality component needs a timing component >= 0.25, else severity <= 0.20 (`QUALITY_ONLY_CAP`) and its flags are not headlined; an elevated timing component needs a second timing one (or a quality one) >= 0.15, else it is capped by its own reliability (`TIMING_ONLY_CAP`: rate 0.35, pausing 0.30, prosody 0.20, transcript 0.40); nothing elevated caps at 0.15. Result on the same variants: 0.00-0.20 (see `tests/test_speech_robustness.py`). The synthetic anchors hold: healthy <= 0.15, borderline 0.39, impaired 1.0. **Cost:** a speaker whose only sign is mis-articulation reads at most 0.20 here.
- **Phoneme trust** (`phoneme_trust`): articulation is multiplied by 1.0 at SNR >= 25 dB down to 0.5 at <= 15 dB, x0.5 more when the decode has > 1.35x the target's phones (other voices), x0.5 when the first or last 3 target phones are all at the floor while the rest is fine ("start/end of the sentence may be missing" flag, no retry: a late mic start would otherwise loop). Trust < 0.75 no longer raises the confidence ceiling.
- **Specific retries** (only when timing shows nothing wrong, or far more syllables than the sentence were said, so a genuinely slow/halting speaker is still scored): decode >= 1.6x target phones -> "I can hear other voices or sound in the background..."; per >= 0.75 and gop_mean <= -5.5 -> "that didn't sound like the sentence, please read it exactly as shown". Header duration > 20 s -> "that recording was too long" (no decode). Silence / very quiet / clipping / short / noise-only keep their earlier messages (verified with silence, zeros, -62 dBFS, 12x clipping, room noise, a tone).
- **Poor conditions:** SNR < 15 dB caps severity at 0.35, multiplies confidence by 0.75 and adds the flag "noisy room, this result may be unreliable".
- **Fallbacks:** phoneme scoring runs in a worker with a 5 s budget (`PHONEME_TIMEOUT_S`; a cold model load of 5-7 s misses it, the startup warm-up avoids that) and a single inference lock (a second overlapping analysis waits <= 3 s, then goes DSP-only). Enabled but unavailable/slow/busy -> DSP-only, confidence <= 0.6, flag "phoneme check unavailable, timing and voice only". 12 further real-model calls add < 250 MB RSS.
- **Endpoint:** at most 2 analyses run at once (`MAX_CONCURRENT_ANALYSES`), a third waits 4 s and gets a normal retry "the analysis service is busy"; timeouts and exceptions stay retry results; nothing is written to disk or logged (tested: no RIFF/WAVE in logs, empty TMPDIR).
- **Browser capture:** worklet -> ScriptProcessor fallback -> "use a current Chrome/Edge/Firefox/Safari over HTTPS" (`unsupported`); a track that stays muted 0.8 s fails fast with a muted message, and a whole take of pure silence says "microphone looks muted or blocked" (not "didn't hear anything"); the first-word loss is avoided by showing "Getting the microphone ready..." until the first audio chunk; an early burst (< 1.2 s, a cough or hesitant start) waits 2 s of silence, not 1.2 s, before the take ends; client "too quiet" threshold lowered from peak 0.03 to 0.02 so a soft voice on a raw mic reaches the backend's RMS/SNR gates. 44.1/48 kHz devices use the windowed-sinc resampler (tested, sine amplitude/frequency kept).
- **Not addressed / known gaps:** real accents and non-native speakers are only approximated by vocal-tract/pitch shifts (real ones need recordings); reverberation is not detected directly (the agreement rule absorbs it; RT60 1.0 s sits close to the 0.25 margin); a lone very slow speaker is capped at 0.35; music/TV that is not speech is only handled by SNR.

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
| Rate | `articulation_rate` (low is bad) | 0.20 | 2.6 → 1.5 syl/s |
| Pausing | `longest_pause_s`, `pause_ratio` | 0.15 | 0.4→1.2 s ; 0.2→0.5 |
| Prosody | `f0_sd_semitones` (low is bad) | 0.10 | 2.0 → 0.8 st |
| Voice quality | `jitter_rap`, `shimmer_apq3` | 0.20 | 0.6%→2.1% ; 2.2%→5.6% |

`severity = Σ weight_i · component_i`. Add flags such as `"transcript mismatch (CER 0.42)"`, `"very slow articulation"`, `"long pauses"`, `"flat pitch"`.
`confidence` = f(SNR, duration, transcript returned, voiced_fraction). If ASR fails, fall back to acoustic-only score with confidence × 0.6.

## Stretch: phoneme-level scoring (`PHONEME_SCORING=true`)
Why: modern STT auto-corrects mumbling, so transcript CER can look perfect on slurred speech. A phoneme recognizer sees what was actually articulated.
- Model: see "As built" above (`mostafaashahin/wav2vec2-base-timit-phoneme-arpa-39`). PyTorch + `transformers`, CPU, warm-loaded at server start. Optional deps live in `requirements-ml.txt` (torch CPU wheel), imported lazily.
- Fixed phrase ⇒ **hardcode the target phoneme sequence** (per phrase in config) so no espeak dependency is needed at runtime.
- Metrics: `per` (phoneme error rate from greedy CTC decode vs target, edit distance), `gop_mean` / `gop_min` (mean and worst per-phoneme log-posterior from CTC forced alignment of the target), `n_bad_phones` (< threshold), plus which phonemes failed for the flags.
- Scoring: add an `articulation` component (`ramp(per; 0.15→0.5)`, `ramp(gop_mean)`) and renormalize weights. If the flag is off or torch is missing, the pipeline silently runs without it and adds a flag `"phoneme scoring off"`.
- Budget: < 3 s on a laptop CPU for a 5 s clip; the whole endpoint still returns within 10 s. Validate on the same normal-vs-slurred fixtures as the calibration step.
- Hosting: demo laptop (backup Railway image stays torch-free).
- Not doing: training a dysarthria classifier (UA-Speech/TORGO are licensed and not stroke-specific).

## Calibration (do this at hour ~20)
- Record **5+ normal** clips from teammates (different voices/accents) and **5+ simulated slurred** clips (slow, mushy consonants, pausing — a teammate acting). Save to `tests/fixtures/audio/{normal,slurred}/`.
- `python -m models.calibrate [--dir …] [--csv out.csv]` (as built) scores every clip in `tests/fixtures/audio/{normal,slurred}/` (committed, consented) and `recordings/speech/` (gitignored; produced by `?record=speech`), prints per-file and per-scenario tables, a per-FEATURE normal-vs-impaired table (mean/sd, Cohen's d, AUC, `WRONG WAY` if a ramp contradicts the data) and the headline numbers; exit 0 = all labelled runs meet expectations. Targets are the shared anchors (healthy ≤ 0.15, borderline 0.2–0.55, clear ≥ 0.85), tuned via `models/config.py`. Full workflow: `docs/CALIBRATION.md`; proof protocol (held-out split, `--freeze`, `--mode validate`, criteria): `docs/VALIDATION.md`. Sidecars carry optional `conditions` (`mic`, `noise`, `nativeEnglish`, `device`) and `env`.
- Acknowledge in the pitch: simulated dysarthria ≠ real patients; this is a heuristic screen.

## Endpoint contract
`POST /api/speech/analyze` (multipart `audio`, `target_phrase`, optional form field `lang`: `en` default or `es`) → `TestResult` with `metrics` (all features above), `flags`, and an extra `transcript: string`. Must return within 10 s; if Scribe is slow (> 6 s), return acoustic-only result with a flag. `lang` is a plain form field, not a `contracts.ts` / `schemas.py` field: any value other than `en`/`es` is a 422.

## Spanish (`/es`, docs/spec/06 "Localization")
The wav2vec2 phoneme model (`models/phoneme.py`) is English-only, so it is **never run** for `lang="es"`: `analyze_speech(..., lang="es")` skips `_phoneme_scores` entirely (not even called) and adds the flag `FLAG_PHONEME_ENGLISH_ONLY` ("phoneme scoring is English-only, DSP checks only"). Scoring then rests on the DSP/voice-quality signals only, which are calibrated on English speech; to stay conservative the whole-result severity is capped at `models/config.NON_ENGLISH_SEVERITY_CAP` (0.5, **uncalibrated**), chosen so `speech` weight (0.5) × capped severity stays under the result screen's caution band (0.3) — Spanish speech alone can never push the score into caution or high, though it can still add to a noisy-OR combination with other checks. The existing timing/quality agreement rule (`severity_cap`) still applies underneath that cap. The Spanish target sentence is `models/config.TARGET_PHRASE_ES` = "No se le pueden enseñar trucos nuevos a un perro viejo." (18 syllables, added to `PHRASE_SYLLABLES`; must match `frontend/src/lib/config.ts` and `docs/agent-prompt.es.md` exactly). The frontend sends `lang` from the site's locale (`useLocale()`), defaulting to `en`. The alert TEXT sent to the demo phone is still built and sent in English regardless of `lang` (`services/email_sms_service.py` is not localized); the Spanish alert preview says so. Tests: `tests/test_speech_lang.py` (offline, monkeypatched phoneme module proves it is never called for `es`, the 422 on any other `lang`, and the severity cap).

## Tests
- Pure-function tests for CER/WER, pause detection on synthetic signals, ramp mapping, and scoring monotonicity.
- Mock `elevenlabs_service` in tests; never call live APIs in CI.
