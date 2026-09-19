// Speech calibration scenarios + the file naming / sidecar format for `?record=1` (pure; see speechRecorder.ts).
// The Python calibration CLI reads <subject>__<scenario>__<timestamp>.wav + .json pairs from recordings/speech/.
import type { TestResult } from '../contracts'

export interface SpeechScenario {
  id: string
  label: string
  expected: 'healthy' | 'deficit'
  instructions: string
}

export const SPEECH_SCENARIOS: SpeechScenario[] = [
  {
    id: 'speech-normal',
    label: 'Speech: normal',
    expected: 'healthy',
    instructions: 'Say the sentence clearly at your normal pace and volume.',
  },
  {
    id: 'speech-fast-casual',
    label: 'Speech: fast and casual',
    expected: 'healthy',
    instructions: 'Say it quickly and casually, like you are talking to a friend. Words may run together a little.',
  },
  {
    id: 'speech-quiet-tired',
    label: 'Speech: quiet and tired',
    expected: 'healthy',
    instructions: 'Say it softly, like you are very tired, but still clearly. Do NOT slur on purpose.',
  },
  {
    id: 'speech-mimic-slurred',
    label: 'Speech: MIMIC slurred',
    expected: 'deficit',
    instructions: 'Act it out: speak slowly with mushy, imprecise consonants, like your tongue is heavy. Blur the words together.',
  },
  {
    id: 'speech-mimic-slow-pauses',
    label: 'Speech: MIMIC slow with long pauses',
    expected: 'deficit',
    instructions: 'Act it out: speak slowly and pause for about a second between words, like finding each word is an effort.',
  },
  {
    id: 'speech-mimic-flat-monotone',
    label: 'Speech: MIMIC flat monotone',
    expected: 'deficit',
    instructions: 'Say every word on the same flat pitch with no expression, like a robot. Normal speed.',
  },
]

export const findSpeechScenario = (id: string): SpeechScenario | undefined => SPEECH_SCENARIOS.find((s) => s.id === id)

const slug = (s: string, fallback: string): string => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback

/** `<subject>__<scenario>__<timestamp>` (no extension); the .wav and .json of one run share it. */
export const speechBaseName = (subject: string, scenario: string, createdAt: string): string =>
  `${slug(subject, 'anon')}__${slug(scenario, 'unlabeled')}__${createdAt.replace(/[:.]/g, '-')}`

export interface SpeechSidecar {
  schema: 1
  kind: 'speech'
  subject: string
  scenario: string
  expected: 'healthy' | 'deficit'
  notes: string
  targetPhrase: string
  durationS: number
  sampleRate: number
  createdAt: string
  liveResult: TestResult
}

export function buildSidecar(args: {
  subject: string
  scenarioId: string
  notes: string
  targetPhrase: string
  durationS: number
  sampleRate: number
  createdAt: string
  liveResult: TestResult
}): SpeechSidecar {
  const scenario = findSpeechScenario(args.scenarioId)
  return {
    schema: 1,
    kind: 'speech',
    subject: args.subject.trim() || 'anon',
    scenario: scenario?.id ?? 'unlabeled',
    expected: scenario?.expected ?? 'healthy',
    notes: args.notes,
    targetPhrase: args.targetPhrase,
    durationS: Math.round(args.durationS * 1000) / 1000,
    sampleRate: args.sampleRate,
    createdAt: args.createdAt,
    liveResult: args.liveResult,
  }
}
