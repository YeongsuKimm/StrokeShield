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
import type { Locale } from '../../lib/i18n'

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
  id: 'eyes' | 'face' | 'arms' | 'speech'
  letter: string
  name: string
  instruction: string
  looksFor: string
  measured: string
}

export const PROCESS_STEPS: ProcessStep[] = [
  {
    id: 'eyes',
    letter: 'E',
    name: 'Eyes',
    instruction: 'Follow a moving dot without turning your head.',
    looksFor: 'One eye that will not travel as far as the other, or eyes that stop moving together.',
    measured: 'Gaze excursion per eye, the difference between them, and any resting deviation.',
  },
  {
    id: 'face',
    letter: 'F',
    name: 'Face',
    instruction: 'Hold a serious, neutral face, then smile as wide as you can and hold it.',
    looksFor: 'One corner of the mouth lifting less than the other.',
    measured: 'Mouth-corner lift per side, corrected for head roll and normalized to the distance between the eyes.',
  },
  {
    id: 'arms',
    letter: 'A',
    name: 'Arms',
    instruction: 'Step back, hold both arms out to the sides, palms up, for ten seconds.',
    looksFor: 'One arm drifting downward while the other stays up.',
    measured: 'Elevation angle per arm over the hold, the drift between them, and wrist height difference.',
  },
  {
    id: 'speech',
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
    a: 'Your video never leaves your browser: face and arm tracking run on this device, and nothing from the camera is uploaded or stored. Audio goes to two places, and only if you use them. The speech test sends one short recording to our server for analysis and to no other company; we do not store it. The optional voice guide, once you press Start guide, streams your microphone audio to ElevenLabs for as long as it is on. Audio saving is off, but ElevenLabs may keep a transcript for up to one day. No photos or video frames are sent anywhere.',
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

const INFO_SECTIONS_ES: InfoSection[] = [
  { id: 'process', nav: 'El proceso', index: '01', title: 'BE-FAST, en cuatro revisiones', lede: 'Una gu\u00eda por cuatro partes de BE-FAST (no revisamos el equilibrio). Cada una produce una estimaci\u00f3n aproximada de gravedad y confianza con reglas sin calibrar. Nada de esto es un diagn\u00f3stico ni una medici\u00f3n cl\u00ednica.' },
  { id: 'why', nav: 'Por qu\u00e9 importa', index: '02', title: 'Cada minuto importa', lede: 'El tratamiento del derrame cerebral funciona mejor cuando empieza pronto. El reloj comienza la \u00faltima vez que te sentiste completamente normal, no cuando empezaste a preocuparte.' },
  { id: 'stats', nav: 'Las cifras', index: '03', title: 'Cifras publicadas sobre el derrame cerebral', lede: 'Estas cifras vienen de los estudios citados debajo de cada una. No son resultados de StrokeShield, cuya precisi\u00f3n no ha sido evaluada.' },
  { id: 'help', nav: 'Preguntas y ayuda', index: '04', title: 'Preguntas y a qui\u00e9n llamar' },
  { id: 'team', nav: 'El equipo', index: '05', title: 'Creado por' },
]

const PROCESS_STEPS_ES: ProcessStep[] = [
  { id: 'eyes', letter: 'E', name: 'Ojos', instruction: 'Sigue un punto en movimiento sin girar la cabeza.', looksFor: 'Un ojo que no se mueve tanto como el otro, o los ojos que dejan de moverse juntos.', measured: 'El recorrido de la mirada de cada ojo, la diferencia entre ellos y cualquier desviaci\u00f3n en reposo.' },
  { id: 'face', letter: 'F', name: 'Cara', instruction: 'Mant\u00e9n una expresi\u00f3n seria y neutra; despu\u00e9s sonr\u00ede todo lo que puedas.', looksFor: 'Una comisura de la boca que se levanta menos que la otra.', measured: 'La elevaci\u00f3n de cada comisura, corregida por la inclinaci\u00f3n de la cabeza y normalizada por la distancia entre los ojos.' },
  { id: 'arms', letter: 'A', name: 'Brazos', instruction: 'Retrocede, extiende ambos brazos con las palmas hacia arriba y mantenlos diez segundos.', looksFor: 'Un brazo que baja mientras el otro permanece levantado.', measured: 'El \u00e1ngulo de elevaci\u00f3n de cada brazo, la ca\u00edda entre ellos y la diferencia de altura de las mu\u00f1ecas.' },
  { id: 'speech', letter: 'S', name: 'Habla', instruction: 'Lee una frase fija en voz alta.', looksFor: 'Habla arrastrada, pausas inusuales, tono plano o palabras pronunciadas de forma incorrecta.', measured: 'Ritmo de articulaci\u00f3n, pausas, variaci\u00f3n del tono y calidad de voz. El modelo fon\u00e9tico opcional en ingl\u00e9s no se usa para espa\u00f1ol.' },
]

const TIME_NOTE_ES = { letter: 'T', name: 'Tiempo', body: 'Si la persona presenta cualquiera de estos s\u00edntomas, aunque desaparezcan, llama al 911 y ll\u00e9vala al hospital inmediatamente.' }

const STATS_ES: Stat[] = [
  { figure: '1.9', unit: 'millones', caption: 'de neuronas perdidas por cada minuto que un derrame cerebral isqu\u00e9mico queda sin tratar.', source: 'Saver, Stroke (2006)' },
  { figure: '4.5', unit: 'horas', caption: 'la ventana para disolver un co\u00e1gulo, medida desde el \u00faltimo momento en que la persona estaba bien.', source: 'Gu\u00eda AHA/ASA (2019)' },
  { figure: '24', unit: 'horas', caption: 'el l\u00edmite m\u00e1ximo para extraer mec\u00e1nicamente un co\u00e1gulo, solo en pacientes cuidadosamente seleccionados.', source: 'Gu\u00eda AHA/ASA (2019)' },
  { figure: '14 \u2192 4', unit: 'por ciento', caption: 'de derrames no identificados por FAST frente a BE-FAST en un estudio. Es un hallazgo sobre la escala cl\u00ednica, no sobre esta aplicaci\u00f3n.', source: 'Aroor et al., Stroke (2017)' },
]

const FAQS_ES: Faq[] = [
  { q: '\u00bfEsto es un diagn\u00f3stico?', a: 'No. StrokeShield solo gu\u00eda una revisi\u00f3n BE-FAST. No tiene precisi\u00f3n cl\u00ednica, no es un dispositivo m\u00e9dico y no ha sido validado: no puede diagnosticar ni descartar un derrame cerebral. Si sospechas un derrame, llama al 911 de inmediato.' },
  { q: '\u00bfQu\u00e9 pasa con el video y el audio?', a: 'El video nunca sale del navegador. La prueba de habla env\u00eda una grabaci\u00f3n corta a nuestro servidor para analizarla y no la guardamos. Si activas la gu\u00eda de voz, ElevenLabs recibe el audio del micr\u00f3fono mientras est\u00e9 conectada. No se guarda el audio, pero ElevenLabs puede conservar una transcripci\u00f3n hasta por un d\u00eda.' },
  { q: '\u00bfQu\u00e9 datos utiliza?', a: 'La c\u00e1mara, procesada solo en este navegador; el micr\u00f3fono; y tu ubicaci\u00f3n si la autorizas. Los resultados se mantienen solo en la memoria de esta pesta\u00f1a. No usamos anal\u00edtica ni rastreadores publicitarios. Borrar mis datos detiene los dispositivos y elimina la informaci\u00f3n de la sesi\u00f3n.' },
  { q: '\u00bfQu\u00e9 hago si una revisi\u00f3n no funciona?', a: 'Puedes omitir cualquier revisi\u00f3n. Si la c\u00e1mara no puede medir algo, se excluye del puntaje en vez de adivinar. Incluso si todo funciona, esta herramienta no puede asegurarte que no haya un derrame cerebral.' },
  { q: '\u00bfRealmente llama a una ambulancia?', a: 'No. En esta demo, el mensaje autom\u00e1tico solo llega a un tel\u00e9fono de demostraci\u00f3n aprobado, nunca a emergencias. El bot\u00f3n rojo llama al 911 desde tu propio dispositivo.' },
  { q: '\u00bfQu\u00e9 hago mientras espero ayuda?', a: 'Si\u00e9ntate o acu\u00e9state en un lugar seguro, no comas ni bebas, abre la puerta si puedes y permanece en la l\u00ednea. Anota la \u00faltima hora en que te sentiste completamente normal.' },
]

const HOTLINES_ES: Hotline[] = [
  { label: 'Servicios de emergencia', detail: 'Ante cualquier sospecha de derrame cerebral. No conduzcas; los param\u00e9dicos pueden empezar el tratamiento en camino.', tel: '911', urgent: true },
  { label: 'American Stroke Association', detail: 'Preguntas no urgentes sobre derrames, recuperaci\u00f3n y apoyo. 1-888-4-STROKE.', tel: '18884787653' },
]

export const getInfoSections = (locale: Locale): InfoSection[] => locale === 'es' ? INFO_SECTIONS_ES : INFO_SECTIONS
export const getProcessSteps = (locale: Locale): ProcessStep[] => locale === 'es' ? PROCESS_STEPS_ES : PROCESS_STEPS
export const getTimeNote = (locale: Locale) => locale === 'es' ? TIME_NOTE_ES : TIME_NOTE
export const getStats = (locale: Locale): Stat[] => locale === 'es' ? STATS_ES : STATS
export const getFaqs = (locale: Locale): Faq[] => locale === 'es' ? FAQS_ES : FAQS
export const getHotlines = (locale: Locale): Hotline[] => locale === 'es' ? HOTLINES_ES : HOTLINES

const JHU = 'Johns Hopkins University'
export const TEAM: Member[] = [
  { name: 'Sathvik S.', affiliation: JHU, major: "Biomedical Engineering" },
  { name: 'Fatih C.', affiliation: JHU, major: "CS + Applied Math"},
  { name: 'Yeongsu K.', affiliation: JHU, major : "CS + Applied Math" },
  { name: 'Leo Y.', affiliation: JHU, major: "Electrical Engineering + CS"},
]
