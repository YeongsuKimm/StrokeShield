// Copy for the info document. Kept as data so wording can be edited without touching layout.
//
// SOURCES for the figures below (check before changing a number — this page is public-facing):
//  - 1.9 million neurons/minute: Saver JL, "Time Is Brain — Quantified", Stroke 2006;37:263-266.
//  - 4.5 h thrombolysis window / up to 24 h thrombectomy in selected patients: AHA/ASA 2019 acute ischemic
//    stroke guideline (windows are measured from LAST KNOWN WELL, not from when symptoms were noticed).
//  - BE-FAST vs FAST missed strokes: Aroor S et al., "BE-FAST", Stroke 2017;48:479-481.
//
// HONESTY RULE: every number in STATS is from a published paper or guideline. NONE of them is a measurement of this
// app, which is uncalibrated and has not been clinically validated. Keep the citations, and never present a figure
// here as StrokeShield's performance. Shared disclaimer wording lives in lib/disclaimer.ts.

export interface InfoSection {
  id: string
  nav: string
  index: string
  title: string
  lede?: string
}

export const INFO_SECTIONS: InfoSection[] = [
  {
    id: 'process',
    nav: 'The process',
    index: '01',
    title: 'BE-FAST, in four checks',
    lede: 'A guide through four of the BE-FAST checks (Balance is not checked). Each one produces a rough severity and a confidence from an uncalibrated heuristic. None of it is a diagnosis or a clinical measurement.',
  },
  {
    id: 'why',
    nav: 'Why it matters',
    index: '02',
    title: 'Why minutes are the whole problem',
    lede: 'Stroke treatment works best when it starts fast. The clock begins the last time you felt completely normal, not the moment you got worried.',
  },
  {
    id: 'stats',
    nav: 'The numbers',
    index: '03',
    title: 'Published numbers about stroke',
    lede: 'These figures come from the published research cited under each one. They are not results from StrokeShield, which has not been tested for accuracy.',
  },
  { id: 'help', nav: 'Questions & hotlines', index: '04', title: 'Questions, and who to call' },
  { id: 'team', nav: 'The team', index: '05', title: 'Built by' },
]

export interface ProcessStep {
  letter: string
  name: string
  instruction: string
  looksFor: string
  measured: string
}

export const PROCESS_STEPS: ProcessStep[] = [
  {
    letter: 'E',
    name: 'Eyes',
    instruction: 'Follow a moving dot without turning your head.',
    looksFor: 'One eye that will not travel as far as the other, or eyes that stop moving together.',
    measured: 'Gaze excursion per eye, the difference between them, and any resting deviation.',
  },
  {
    letter: 'F',
    name: 'Face',
    instruction: 'Hold a serious, neutral face, then smile as wide as you can and hold it.',
    looksFor: 'One corner of the mouth lifting less than the other.',
    measured: 'Mouth-corner lift per side, corrected for head roll and normalised to the distance between the eyes.',
  },
  {
    letter: 'A',
    name: 'Arms',
    instruction: 'Step back, hold both arms out to the sides, palms up, for ten seconds.',
    looksFor: 'One arm drifting downward while the other stays up.',
    measured: 'Elevation angle per arm over the hold, the drift between them, and wrist height difference.',
  },
  {
    letter: 'S',
    name: 'Speech',
    instruction: 'Read one fixed sentence out loud.',
    looksFor: 'Slurring, unusual pauses, a flattened pitch, words that come out wrong.',
    measured: 'Transcript accuracy against the target sentence, articulation rate, pause structure, pitch variation and voice quality.',
  },
]

export const TIME_NOTE = {
  letter: 'T',
  name: 'Time',
  body:
    'If the person shows any of these symptoms, even if the symptoms go away, call 911 and get them to the hospital immediately',
}

export interface Stat {
  figure: string
  unit: string
  caption: string
  source: string
}

export const STATS: Stat[] = [
  {
    figure: '1.9',
    unit: 'million',
    caption: 'neurons lost every minute an ischemic stroke goes untreated.',
    source: 'Saver, Stroke (2006)',
  },
  {
    figure: '4.5',
    unit: 'hours',
    caption: 'the clot-dissolving window, measured from the last moment the person was known to be well.',
    source: 'AHA/ASA guideline (2019)',
  },
  {
    figure: '24',
    unit: 'hours',
    caption: 'the outer limit for mechanical clot removal, and only for carefully selected patients.',
    source: 'AHA/ASA guideline (2019)',
  },
  {
    figure: '14 → 4',
    unit: 'percent',
    caption: 'percent of strokes missed by FAST versus BE-FAST, in one published study. A finding about the clinical BE-FAST scale, not about this app.',
    source: 'Aroor et al., Stroke (2017)',
  },
]

export interface Faq {
  q: string
  a: string
}

export const FAQS: Faq[] = [
  {
    q: 'Is this a diagnosis?',
    a: 'No. StrokeShield is only a tool to help guide someone through the BE-FAST stroke check. It is not clinically accurate, not a medical device and has not been validated: it cannot diagnose or rule out a stroke. A result of "nothing flagged" means nothing. If you think someone may be having a stroke, call 911 right away.',
  },
  {
    q: 'What happens to the video and audio?',
    a: 'Your video never leaves your browser: face and arm tracking run on this device, and nothing from the camera is uploaded or stored. Audio goes to two places, and only if you use them. The speech test sends one short recording to our server for analysis and to no other company; we do not store it. The optional voice guide, once you press Start guide, streams your microphone audio to ElevenLabs for as long as it is on, and ElevenLabs may keep the recording and transcript under its own privacy policy. No photos or video frames are sent anywhere.',
  },
  {
    q: 'What data does this use?',
    a: 'The camera (processed in this browser only), the microphone (the speech recording, and the voice guide if you turn it on) and, if you allow it, your location. Results, the transcript and your location are kept in this tab’s memory only and nothing is written to your browser storage. If an alert is sent, one text goes to a demo phone with your location if allowed, what the checks flagged, and when you were last well if you told the guide. We do not sell data or use it for ads, and this site loads no analytics or ad trackers. “Clear my data” (or the logo) stops the camera and microphone, ends the voice guide and wipes it all. StrokeShield is designed to minimize data. It is a demo, not a medical device, and we make no compliance claims.',
  },
  {
    q: 'What if a check does not work?',
    a: 'Every check can be skipped, and a check the camera could not measure is dropped from the score rather than guessed at. If nothing could be measured, the result says so. Even when every check is measured, this tool can never reassure you.',
  },
  {
    q: 'Does it really call an ambulance?',
    a: 'In this demo the automatic text goes to one verified demo phone only, never to emergency services. The red button dials your own device’s emergency number directly, and it is always on screen.',
  },
  {
    q: 'What should I do while waiting for help?',
    a: 'Sit or lie down somewhere safe, do not eat or drink anything, unlock the front door if you can, and stay on the line. Note the time you last felt completely normal.',
  },
]

export interface Hotline {
  label: string
  detail: string
  tel: string
  urgent?: boolean
}

export const HOTLINES: Hotline[] = [
  {
    label: 'Emergency services',
    detail: 'Any suspected stroke. Do not drive yourself — paramedics start treatment on the way.',
    tel: '911',
    urgent: true,
  },
  {
    label: 'American Stroke Association',
    detail: 'Non-urgent questions about stroke, recovery and support. 1-888-4-STROKE.',
    tel: '18884787653',
  },
]

export interface Member {
  name: string
  affiliation: string
}

const JHU = 'Johns Hopkins University'
export const TEAM: Member[] = [
  { name: 'Sathvik S.', affiliation: JHU },
  { name: 'Fatih C.', affiliation: JHU },
  { name: 'Yeongsu K.', affiliation: JHU },
  { name: 'Leo Y.', affiliation: JHU },
]
