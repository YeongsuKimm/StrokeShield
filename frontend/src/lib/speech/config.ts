// Speech capture thresholds. ALL VALUES ARE UNCALIBRATED until tuned with real mics (see docs/spec/03-speech.md).
// Kept in lib/speech (not lib/config.ts) so this module owns them.

export const SPEECH_SAMPLE_RATE = 16_000 as const

export const SPEECH_CAPTURE = {
  /** Hard cap on one recording (spec 03: "up to 6 s"). */
  maxSeconds: 6,
  /** Never auto-stop before this much audio exists (spec 03: min 1.5 s; the backend rejects shorter clips). */
  minSeconds: 1.5,
  /** Auto-stop once this much silence follows detected speech (spec 03). */
  trailingSilenceSeconds: 1.2,
  /**
   * While the utterance so far is shorter than `earlyUtteranceSeconds` (a cough, a click, or a hesitant "you can't...") wait
   * this much silence instead: a healthy person who pauses to think, or starts late after a cough, must not be cut off
   * (the backend would then judge half a sentence).
   */
  earlyUtteranceSeconds: 1.2,
  earlyTrailingSilenceSeconds: 2.0,
  /** Give up if nobody has spoken after this long. */
  noSpeechSeconds: 4,
  /** Silence kept around the utterance when trimming the clip before upload. */
  padBeforeSeconds: 0.3,
  padAfterSeconds: 0.5,
}

export const VAD_CONFIG = {
  frameSeconds: 0.02,
  /** A frame is "voiced" above max(absMinRms, noiseFloor * speechToFloorRatio). 3x is about +9.5 dB over the floor. */
  speechToFloorRatio: 3,
  /** ~ -44 dBFS. Below this nothing is speech, however quiet the room (a dead-silent mic reads ~0). */
  absMinRms: 0.006,
  /** Consecutive voiced frames (80 ms) before "speech started"; keeps a single click/pop from counting. */
  startFrames: 4,
  /** Noise floor is tracked only on unvoiced frames: falls fast (follows the room down), rises slowly (fan spin-up). */
  floorFallAlpha: 0.3,
  floorRiseAlpha: 0.01,
  /** Frames at the start over which the floor is the running minimum instead of an EMA (first 200 ms). */
  warmupFrames: 10,
  minFloor: 0.0005,
  /** ~ -30 dBFS: a room noisier than this is unusable anyway; the cap also stops speech that starts at t=0 from being taken as the floor. */
  maxFloor: 0.03,
}

export const SPEECH_QC = {
  /**
   * Peak below ~ -34 dBFS: too quiet for reliable jitter/shimmer/HNR (the backend also rejects low SNR and RMS < -50 dBFS).
   * Was 0.03; a soft voice on a raw (no AGC) laptop mic peaks at 0.02-0.05, and the backend is the better judge of that.
   */
  minPeak: 0.02,
  /** Peak below ~ -60 dBFS over the whole take = digital silence: a muted, blocked or dead microphone, not a quiet room. */
  silentPeak: 0.001,
  /** Fraction of samples at full scale. The backend rejects > 1 % clipping (spec 03), so we do too. */
  maxClipping: 0.01,
  /** |x| at or above this counts as clipped. */
  clipLevel: 0.999,
}
