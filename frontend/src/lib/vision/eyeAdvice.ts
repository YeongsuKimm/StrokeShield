// Eyes test: every reason a run can fail, in plain spoken-friendly words. PURE (strings in, strings out).
// Used by the analyzer + capture controller (flags[0] of a retry result), by the screen (headline + tips next to the
// buttons) and, through flags[0], by the voice agent. Spec: docs/spec/02-vision.md "Eyes test" -> "Outcomes".
//
// Convention (same as face/arms): flags[0] of a retry result is a short LOWER-CASE phrase without a trailing period.
// The screen turns it into a sentence with `sentence()`.

/** TECHNICAL causes (the camera could not read the eyes). Behavioral outcomes are completed results, not retries. */
export const EYE_MSG = {
  lostEyes: 'lost sight of your eyes: face the screen and add light',
  dark: 'too dark to see your eyes: add light in front of you',
  glare: 'eyes are hard to track: take off glasses if there is glare',
  headTurned: 'your head moved: keep it still and move only your eyes',
  lookStraight: 'look straight at the screen, then follow the dot with your eyes only',
  lookAtDot: 'look at the dot, then follow it with your eyes only',
  tooFar: 'too far from the screen: move a little closer',
  tooClose: 'too close to the screen: move back a little',
  offCenter: 'face not centered: center your face in the view',
} as const

export type EyeCause = keyof typeof EYE_MSG

const CAUSE_BY_MESSAGE = new Map<string, EyeCause>(
  (Object.entries(EYE_MSG) as [EyeCause, string][]).map(([cause, msg]) => [msg, cause]),
)

/** Which cause a retry flag belongs to (undefined for a flag this module did not write). */
export const eyeCauseOf = (flag0: string | undefined): EyeCause | undefined => (flag0 ? CAUSE_BY_MESSAGE.get(flag0) : undefined)

/**
 * Message for "framing never became OK within the wait timeout", from the last framing hint the gate produced
 * (checkFaceFraming / withYawGate texts). Falls back to the general "lost your eyes" advice.
 */
export function eyeWaitTimeoutMessage(lastHint: string): string {
  const h = lastHint.toLowerCase()
  if (h.includes('look straight')) return EYE_MSG.lookStraight
  if (h.includes('closer')) return EYE_MSG.tooFar
  if (h.includes('move back')) return EYE_MSG.tooClose
  if (h.includes('center')) return EYE_MSG.offCenter
  return EYE_MSG.lostEyes
}

const TIPS: Record<EyeCause, string[]> = {
  lostEyes: ['Face the screen straight on, about an arm’s length away.', 'Add light in front of you (a window or lamp behind you makes it worse).'],
  dark: ['Turn on a light in front of you.', 'Face the screen straight on.'],
  glare: ['Take off your glasses if the screen or a lamp reflects in them.', 'Use even light in front of you.'],
  headTurned: ['Keep your head still, like a passport photo.', 'Move only your eyes to follow the dot.'],
  lookStraight: ['Look straight at the screen before the dot starts.', 'Then follow the dot with your eyes only.'],
  lookAtDot: ['Watch the yellow dot the whole time.', 'Follow it with your eyes only, without moving your head.'],
  tooFar: ['Sit about an arm’s length from the screen.'],
  tooClose: ['Sit about an arm’s length from the screen.'],
  offCenter: ['Center your face inside the outline.'],
}

/** "lost sight of ..." -> "Lost sight of ...." for on-screen text. */
export const sentence = (s: string): string => {
  const t = s.trim()
  if (!t) return t
  const cap = t.charAt(0).toUpperCase() + t.slice(1)
  return /[.!?]$/.test(cap) ? cap : `${cap}.`
}

/** Headline + tips for a failed eye check, or null when the flag is empty / a cancel. */
export function eyeAdvice(flag0: string | undefined): { headline: string; tips: string[] } | null {
  if (!flag0 || flag0 === 'Cancelled.') return null
  const cause = eyeCauseOf(flag0)
  if (!cause) return { headline: sentence(flag0), tips: [] } // e.g. "I couldn't start the camera. ..." from the runner
  return { headline: sentence(flag0), tips: TIPS[cause] }
}
