// Thresholds and weights. ALL VALUES ARE UNCALIBRATED until tuned on fixtures (see docs/spec/05).

export const RISK_THRESHOLD = 0.5

// Max contribution of each signal to the noisy-OR risk score.
export const MAX_WEIGHTS = {
  face: 0.6,
  arms: 0.6,
  speech: 0.5,
  vision: 0.25,
} as const

// Results below this confidence are excluded from scoring and shown as "couldn't measure".
export const MIN_CONFIDENCE = 0.3

export const COUNTDOWN_SECONDS = 10
export const USER_REQUEST_COUNTDOWN_SECONDS = 3

export const SPEECH_TARGET_PHRASE = "You can't teach an old dog new tricks."
