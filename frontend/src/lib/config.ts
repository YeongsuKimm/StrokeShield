import type { TestName } from './contracts'

// Thresholds and weights. ALL VALUES ARE UNCALIBRATED until tuned on fixtures (see docs/spec/05).

export const RISK_THRESHOLD = 0.5

// Stretch features, OFF until they're built, tested and demo-stable (docs/spec/00-overview.md).
// Mutable object so tests can toggle it.
export const FEATURES = {
  eyesTest: false, // BE-FAST gaze-following test (docs/spec/02-vision.md)
}

// Test order. Face/eyes/speech are done CLOSE to the screen (best landmarks + mic), then the patient steps
// BACK once for the arms test (both hands must be in frame). Change here if the order needs to change.
export const testSequence = (): TestName[] =>
  FEATURES.eyesTest ? ['face', 'eyes', 'speech', 'arms'] : ['face', 'speech', 'arms']

// Where the patient should be for each test.
export const FRAMING: Record<TestName, 'close' | 'far'> = { face: 'close', eyes: 'close', speech: 'close', arms: 'far' }

// Framing gates (fractions of frame width; UNCALIBRATED). See docs/spec/02-vision.md "Positioning".
export const FRAMING_LIMITS = {
  faceWidthMin: 0.18, // smaller => "move closer"
  faceWidthMax: 0.6, // larger => "move back a little"
  shoulderWidthMin: 0.09, // arms test: smaller => too far away
  minVisibility: 0.5,
  edgeMargin: 0.02, // landmarks closer to the frame edge than this count as out of frame
  holdOkMs: 1500, // framing must stay OK this long before a test starts
  waitTimeoutMs: 25_000, // give up waiting for the patient to get into position
}

// Max contribution of each signal to the noisy-OR risk score.
export const MAX_WEIGHTS = {
  face: 0.6,
  arms: 0.6,
  speech: 0.5,
  eyes: 0.3, // stretch; glasses/strabismus cause false positives, so keep it low
  vision: 0.25,
} as const

// Results below this confidence are excluded from scoring and shown as "couldn't measure".
export const MIN_CONFIDENCE = 0.3

export const COUNTDOWN_SECONDS = 10
export const USER_REQUEST_COUNTDOWN_SECONDS = 3

export const SPEECH_TARGET_PHRASE = "You can't teach an old dog new tricks."
