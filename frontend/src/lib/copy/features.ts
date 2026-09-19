// User-visible copy for four small features, in ONE place so it can be translated in one pass: the home-page
// hint, the alert-text preview, "Copy summary" and the "numbers behind each check" panel, plus the three result
// band messages (moved here from ResultScreen so the copied summary uses the very same words as the screen).
// Plain US English, ASCII source (typographic quotes are applied where a string is drawn; see lib/typography.ts).
// Never write "all clear", "you are fine" or a diagnosis here: the checks measure, they do not diagnose.
import type { ResultBand } from '../config'

/** One quiet line under "Start the check". `count` is the number of checks as a word ("four"). */
export const homeStepsHint = (count: string): string => `Allow camera and mic, do ${count} short checks, then see what was flagged.`

/** The result banner wording. The label + body are also what "Copy summary" writes down. */
export const RESULT_BAND_COPY: Record<ResultBand, { label: string; body: string }> = {
  high: {
    label: 'The checks flagged possible signs',
    body: 'One or more checks came back abnormal. This is not a diagnosis, but treat it as an emergency: call 911 now.',
  },
  caution: {
    label: 'One check was borderline',
    body: 'This tool cannot tell whether it means anything. If this is new, or you are worried, call 911 or get seen right away.',
  },
  low: {
    label: 'These checks did not flag anything',
    body: 'That does not mean you are not having a stroke: these checks cannot rule one out. If you have any symptoms now, or they start or change, call 911 right away.',
  },
}

/** The exact alert text, shown before and after it is sent. */
export const PREVIEW_COPY = {
  before: 'This is the text that will be sent',
  sent: 'This is the text that was sent',
  failed: 'This is the text that did not go through',
  demoSent: 'This is the text a live alert would send',
  live: 'Delivery is best effort.',
  demoBefore: 'Demo mode: nothing will be sent.',
  demoAfter: 'Demo mode: nothing was sent.',
} as const

export const SUMMARY_COPY = {
  button: 'Copy summary',
  copied: 'Summary copied',
  failed: 'Could not copy automatically. Select the text below and copy it.',
  manualLabel: 'Summary to copy',
  title: 'StrokeShield check summary',
  guideOnly: 'A guide only, not a diagnosis.',
  date: 'Date',
  completed: 'Checks completed',
  skipped: 'Checks skipped or not measured',
  none: 'none',
  nothingFlagged: 'nothing flagged',
  result: 'Result',
  lastWell: 'Last known well',
  call911: 'Call 911 if you think this is a stroke.',
  checkNames: { face: 'Face', arms: 'Arms', eyes: 'Eyes', speech: 'Speech' },
} as const

export const MEASURED_COPY = {
  summary: 'The numbers behind each check',
  intro: "These come from the camera and microphone during your checks. Left and right are the patient's own left and right. Nothing is stored; Clear my data wipes them.",
  note: 'Measured, not a diagnosis.',
  notMeasured: 'Not measured.',
  reasonSkipped: 'This check was skipped.',
  reasonUnclear: 'The capture was not clear enough to measure.',
  reasonNotRun: 'This check was not run.',
  checkNames: { face: 'Face', arms: 'Arms', eyes: 'Eyes', speech: 'Speech' },
  face: {
    leftLift: "Mouth corner lift, left",
    rightLift: "Mouth corner lift, right",
    difference: 'Difference between sides',
    unitLift: (v: string) => `${v}% of eye distance`,
  },
  arms: {
    left: 'Left arm',
    right: 'Right arm',
    wristGap: 'Wrist height gap',
    lowest: (angle: string) => `lowest ${angle}`,
    drift: (drift: string) => `drift ${drift}`,
    degrees: (n: string) => (n === '1' ? '1 degree' : `${n} degrees`),
    above: (deg: string) => `${deg} above level`,
    below: (deg: string) => `${deg} below level`,
    level: 'level',
    down: (deg: string) => `${deg} down`,
    up: (deg: string) => `${deg} up`,
    noDrift: 'no drift',
    gapUnit: (pct: string) => `${pct}% of shoulder width`,
  },
  eyes: {
    left: 'Gaze range, looking left',
    right: 'Gaze range, looking right',
    difference: 'Difference between sides',
    unit: (v: string) => `${v} eye widths`,
  },
  speech: {
    rate: 'Speaking rate',
    pauses: 'Pauses',
    clarity: 'Recording clarity',
    rateSyllables: (v: string) => `${v} syllables per second`,
    rateWords: (v: string) => `${v} words per second`,
    pausesValue: (count: string, longest: string) => `${count} pauses, longest ${longest} seconds`,
    pauseOne: (longest: string) => `1 pause, ${longest} seconds`,
    noPauses: 'no pauses',
    clarityValue: (db: string) => `${db} dB above background noise`,
  },
} as const
