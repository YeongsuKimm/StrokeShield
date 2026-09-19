import type { TestName } from './contracts'

// Thresholds and weights. ALL VALUES ARE UNCALIBRATED until tuned on fixtures (see docs/spec/05).

export const RISK_THRESHOLD = 0.5

// Stretch features, OFF until they're built, tested and demo-stable (docs/spec/00-overview.md).
// Mutable object so tests can toggle it.
export const FEATURES = {
  eyesTest: true, // BE-FAST gaze-following test (docs/spec/02-vision.md). UNVERIFIED on a live camera.
}

// Test order. Speech/eyes/face are done CLOSE to the screen (best landmarks + mic), then the patient steps
// BACK once for the arms test (both hands must be in frame). Change here if the order needs to change.
// Order follows the UX storyboard: read aloud -> follow the dot -> smile -> step back -> hold arms out.
export const testSequence = (): TestName[] =>
  FEATURES.eyesTest ? ['speech', 'eyes', 'face', 'arms'] : ['speech', 'face', 'arms']

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
  waitTimeoutMs: 12_000, // retry bad framing before the 15 s skip hatch appears
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

// A test screen offers a "Skip this step" escape hatch once the patient has been stuck this long, so a framing
// gate that never passes can never trap them (docs/spec/06-frontend-ux.md).
export const SKIP_OFFER_MS = 15_000

// UI-only outcome bands (the alert trigger is still RISK_THRESHOLD alone, see docs/spec/05).
// `caution` is the "some signal, below the trigger" middle band that gets the self-help options screen.
// UNCALIBRATED.
export const CAUTION_RISK = 0.2

export type ResultBand = 'high' | 'caution' | 'low'
export const resultBand = (risk: number): ResultBand =>
  risk >= RISK_THRESHOLD ? 'high' : risk >= CAUTION_RISK ? 'caution' : 'low'
