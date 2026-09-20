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
    measured: 'Mouth-corner lift per side, corrected for head roll and normalized to the distance between the eyes.',
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
    instruction: 'Read a fixed sentence out loud.',
    looksFor: 'Slurring, unusual pauses, a flattened pitch, words that come out wrong.',
    measured: 'Articulation rate, pause structure, pitch variation and voice quality, plus phoneme accuracy against the target sentence when the optional phoneme model is on.',
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
    caption: 'of strokes missed by FAST versus BE-FAST, in one published study. A finding about the clinical BE-FAST scale, not about this app.',
    source: 'Aroor et al., Stroke (2017)',
  },
]

/**
 * Links out of the numbers section. Every URL was opened and checked before it went in (a link that 404s on a page about
 * a medical emergency is worse than no link). Two kinds:
 * - "learn": plain-language education about the signs, from US public-health sources.
 * - "research": the papers behind each figure above, linked by DOI so they keep working if a publisher reorganises.
 * Adding one? Open it first, and keep the wording to what the page actually is.
 */
export interface Resource {
  group: 'learn' | 'research'
  /** Who publishes it. */
  org: string
  /** The page or paper title, as its publisher gives it. */
  title: string
  /** One plain line on what it is, or which number above it backs. */
  detail: string
  href: string
}

export const RESOURCE_GROUPS: Record<Resource['group'], { label: string; lede: string }> = {
  learn: { label: 'Learn the signs', lede: 'Plain-language guides from US health organizations.' },
  research: { label: 'The research behind the numbers', lede: 'The published papers each figure above comes from.' },
}

export const RESOURCES: Resource[] = [
  {
    group: 'learn',
    org: 'American Stroke Association',
    title: 'Stroke symptoms and warning signs',
    detail: 'The warning signs of a stroke, including the F.A.S.T. check.',
    href: 'https://www.stroke.org/en/about-stroke/stroke-symptoms',
  },
  {
    group: 'learn',
    org: 'National Institute of Neurological Disorders and Stroke',
    title: 'Stroke',
    detail: 'An overview of stroke from the U.S. National Institutes of Health.',
    href: 'https://www.ninds.nih.gov/health-information/disorders/stroke',
  },
  {
    group: 'learn',
    org: 'MedlinePlus',
    title: 'Stroke',
    detail: 'Health information for patients from the U.S. National Library of Medicine.',
    href: 'https://medlineplus.gov/stroke.html',
  },
  {
    group: 'research',
    org: 'Saver, Stroke (2006)',
    title: 'Time Is Brain—Quantified',
    detail: 'Where the 1.9 million neurons a minute comes from.',
    href: 'https://doi.org/10.1161/01.STR.0000196957.55928.ab',
  },
  {
    group: 'research',
    org: 'Powers et al., Stroke (2019)',
    title: 'Guidelines for the Early Management of Patients With Acute Ischemic Stroke: 2019 Update',
    detail: 'Where the 4.5 hour and 24 hour treatment windows come from.',
    href: 'https://doi.org/10.1161/STR.0000000000000211',
  },
  {
    group: 'research',
    org: 'Aroor, Singh and Goldstein, Stroke (2017)',
    title: 'BE-FAST (Balance, Eyes, Face, Arm, Speech, Time): Reducing the Proportion of Strokes Missed Using the FAST Mnemonic',
    detail: 'Where the 14% to 4% figure comes from. A study of the clinical scale, not of this app.',
    href: 'https://doi.org/10.1161/STROKEAHA.116.015169',
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
    a: 'In this demo the automatic text goes to one pre-approved demo phone only, never to emergency services. The red button dials your own device’s emergency number directly, and it is always on screen.',
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
    detail: 'Any suspected stroke. Do not drive yourself; paramedics start treatment on the way.',
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
  major: string
}

const JHU = 'Johns Hopkins University'
export const TEAM: Member[] = [
  { name: 'Sathvik S.', affiliation: JHU, major: "Biomedical Engineering" },
  { name: 'Fatih C.', affiliation: JHU, major: "CS + Applied Math"},
  { name: 'Yeongsu K.', affiliation: JHU, major : "CS + Applied Math" },
  { name: 'Leo Y.', affiliation: JHU, major: "Electrical Engineering + CS"},
]
