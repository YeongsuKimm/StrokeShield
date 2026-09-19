// The plain-language privacy copy shown before anything is captured (consent panel, voice-guide prompt, info FAQ).
// Kept as data so the wording can be reviewed in one place. Every statement must stay TRUE to what the code and the
// backend do (docs/spec/06 "Privacy"); if the data flow changes, change this in the same commit.
//
// Do not say "HIPAA compliant", "fully private" or "secure": this is a demo designed to minimise data, nothing more.

/** Shown as bullets in the consent panel. */
export const CONSENT_POINTS: { label: string; text: string }[] = [
  // First on purpose: what this is (and is not) is read before anything about data.
  { label: 'Not a diagnosis', text: 'This is a guide, not a medical device. It cannot diagnose or rule out a stroke.' },
  {
    label: 'Video',
    text: 'Face and arm tracking run here. Video and face landmarks are not uploaded or stored.',
  },
  {
    label: 'Speech',
    text: 'One short speech recording goes to our server for analysis. We do not store it or send it elsewhere.',
  },
  {
    label: 'Voice guide',
    text: 'Optional. When on, your microphone streams to ElevenLabs, which may keep the recording and transcript.',
  },
  {
    label: 'Alert text',
    text: 'An alert may include your location, flagged checks, and last-known-well time. It goes to one demo phone through Gmail and the carrier.',
  },
  {
    label: 'Your data',
    text: 'We do not sell your data or use it for ads. Clear my data wipes browser data.',
  },
]

export const CONSENT_CHECKBOX_LABEL = 'I have read this and agree to these uses.'

/** Shown before the voice guide connects (a separate, per-feature opt-in). */
export const VOICE_CONSENT_TEXT =
  'The voice guide streams your microphone audio to ElevenLabs, a third party, while it is on. ElevenLabs may keep the recording and transcript under its own privacy policy. End guide stops it.'

/**
 * Second-opinion still frames (NOT wired yet: no capture code exists). When built, it must be a separate checkbox,
 * UNCHECKED by default, next to this sentence, and nothing may be sent unless it is ticked.
 */
export const SECOND_OPINION_CONSENT_TEXT =
  'Send two still photos to Google Gemini for an extra automated check (not a medical opinion). On the free tier Google may use them to improve its products, and human reviewers may read them.'

export const BROWSER_GRANT_NOTE =
  'Your browser may still remember camera, microphone and location permission. Reset it from the lock icon in the address bar.'
