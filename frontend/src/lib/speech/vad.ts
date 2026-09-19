// Frame-energy voice activity detector with an adaptive noise floor, plus the auto-stop rule for the speech recorder.
// Pure and injectable: feed it Float32Array chunks of any size, read the state back. No DOM, no clocks (time = samples fed).
import { SPEECH_CAPTURE, VAD_CONFIG } from './config'

export type StopReason = 'silence' | 'max-duration' | 'no-speech'

export interface VadState {
  /** Seconds of audio fed so far (whole frames only). */
  elapsedS: number
  /** RMS of the most recent chunk, 0..1 (for a level meter). */
  level: number
  /** Current noise-floor estimate (RMS). */
  noiseFloor: number
  speechDetected: boolean
  /** Start of the first voiced run, seconds (null until speech is detected). */
  speechStartS: number | null
  /** End of the most recent voiced frame, seconds. */
  lastVoicedEndS: number | null
  /** Silence since the last voiced frame; 0 until speech is detected. */
  trailingSilenceS: number
  /** Non-null once the recording should stop. Sticky. */
  stop: StopReason | null
}

export interface SilenceDetectorOptions {
  maxSeconds: number
  minSeconds: number
  trailingSilenceSeconds: number
  noSpeechSeconds: number
}

export interface SilenceDetector {
  push: (chunk: Float32Array) => VadState
  readonly state: VadState
}

const DEFAULT_OPTS: SilenceDetectorOptions = {
  maxSeconds: SPEECH_CAPTURE.maxSeconds,
  minSeconds: SPEECH_CAPTURE.minSeconds,
  trailingSilenceSeconds: SPEECH_CAPTURE.trailingSilenceSeconds,
  noSpeechSeconds: SPEECH_CAPTURE.noSpeechSeconds,
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/**
 * Stop rules (docs/spec/03-speech.md):
 *  - never before `minSeconds` of audio, EXCEPT the hard cap `maxSeconds` (which wins if the two conflict);
 *  - after speech was detected: stop once trailing silence >= `trailingSilenceSeconds`;
 *  - hard stop at `maxSeconds` ('max-duration');
 *  - no speech at all by `noSpeechSeconds` -> 'no-speech'.
 */
export function createSilenceDetector(sampleRate: number, options: Partial<SilenceDetectorOptions> = {}): SilenceDetector {
  const opts = { ...DEFAULT_OPTS, ...options }
  const cfg = VAD_CONFIG
  const frameLen = Math.max(1, Math.round(sampleRate * cfg.frameSeconds))
  const frameS = frameLen / sampleRate
  const carry = new Float32Array(frameLen)
  let carried = 0
  let frames = 0
  let floor = Number.POSITIVE_INFINITY
  let voicedRun = 0

  const state: VadState = {
    elapsedS: 0,
    level: 0,
    noiseFloor: cfg.minFloor,
    speechDetected: false,
    speechStartS: null,
    lastVoicedEndS: null,
    trailingSilenceS: 0,
    stop: null,
  }

  function frameRms(buf: Float32Array, off: number): number {
    let mean = 0
    for (let i = 0; i < frameLen; i++) mean += buf[off + i]
    mean /= frameLen // remove DC so a biased mic does not look like signal
    let s = 0
    for (let i = 0; i < frameLen; i++) {
      const d = buf[off + i] - mean
      s += d * d
    }
    return Math.sqrt(s / frameLen)
  }

  function processFrame(rms: number) {
    const idx = frames++
    const warm = idx < cfg.warmupFrames
    if (warm) floor = Math.min(floor, rms)
    const f = clamp(Number.isFinite(floor) ? floor : rms, cfg.minFloor, cfg.maxFloor)
    const voiced = rms > Math.max(cfg.absMinRms, f * cfg.speechToFloorRatio)
    const endS = frames * frameS
    if (voiced) {
      voicedRun++
      if (!state.speechDetected && voicedRun >= cfg.startFrames) {
        state.speechDetected = true
        state.speechStartS = (frames - voicedRun) * frameS
      }
      if (state.speechDetected) state.lastVoicedEndS = endS
    } else {
      voicedRun = 0
      if (!warm) {
        const alpha = rms < f ? cfg.floorFallAlpha : cfg.floorRiseAlpha
        floor = clamp(f + alpha * (rms - f), cfg.minFloor, cfg.maxFloor)
      }
    }
    state.noiseFloor = clamp(Number.isFinite(floor) ? floor : cfg.minFloor, cfg.minFloor, cfg.maxFloor)
    state.elapsedS = endS
    state.trailingSilenceS = state.speechDetected && state.lastVoicedEndS !== null ? Math.max(0, endS - state.lastVoicedEndS) : 0
    // Compare with a small epsilon so 60 x 20 ms frames == 1.2 s despite float error.
    const eps = 1e-9
    if (endS + eps >= opts.maxSeconds) state.stop = 'max-duration'
    else if (!state.speechDetected && endS + eps >= opts.noSpeechSeconds) state.stop = 'no-speech'
    else if (state.speechDetected && endS + eps >= opts.minSeconds && state.trailingSilenceS + eps >= opts.trailingSilenceSeconds) state.stop = 'silence'
  }

  function push(chunk: Float32Array): VadState {
    if (state.stop) return state
    let sumSq = 0
    for (let i = 0; i < chunk.length; i++) sumSq += chunk[i] * chunk[i]
    state.level = chunk.length ? Math.sqrt(sumSq / chunk.length) : 0
    let pos = 0
    if (carried > 0) {
      const take = Math.min(frameLen - carried, chunk.length)
      carry.set(chunk.subarray(0, take), carried)
      carried += take
      pos = take
      if (carried === frameLen) {
        processFrame(frameRms(carry, 0))
        carried = 0
      }
    }
    while (!state.stop && pos + frameLen <= chunk.length) {
      processFrame(frameRms(chunk, pos))
      pos += frameLen
    }
    if (!state.stop && pos < chunk.length) {
      const rest = chunk.subarray(pos)
      carry.set(rest, 0)
      carried = rest.length
    }
    return state
  }

  return { push, state }
}

/**
 * Sample range to upload: the utterance plus a little silence either side (backend QC estimates SNR from the quietest
 * frames, so keep some), widened to at least `minSeconds` (the backend rejects clips under 1.5 s) and clamped to the clip.
 * If no speech was detected the whole clip is returned.
 */
export function speechWindow(
  state: Pick<VadState, 'speechStartS' | 'lastVoicedEndS'>,
  sampleRate: number,
  totalSamples: number,
  padBeforeS = SPEECH_CAPTURE.padBeforeSeconds,
  padAfterS = SPEECH_CAPTURE.padAfterSeconds,
  minSeconds = SPEECH_CAPTURE.minSeconds,
): [number, number] {
  if (state.speechStartS === null || state.lastVoicedEndS === null) return [0, totalSamples]
  let start = Math.max(0, Math.floor((state.speechStartS - padBeforeS) * sampleRate))
  let end = Math.min(totalSamples, Math.ceil((state.lastVoicedEndS + padAfterS) * sampleRate))
  const minLen = Math.min(totalSamples, Math.ceil(minSeconds * sampleRate))
  if (end - start < minLen) {
    const missing = minLen - (end - start)
    end = Math.min(totalSamples, end + missing)
    start = Math.max(0, end - minLen)
  }
  return [start, end]
}
