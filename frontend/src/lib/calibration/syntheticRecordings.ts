// Test support: synthetic face recordings for MANY fake subjects, built from the face test utils. Used by the validation
// tests (split stability, criteria, PUBLIC report leak check, freeze transitions). Not imported by app code.
import { BORDERLINE, droopLeft, droopRight, makeCapture, NATURAL_MILD, SYMMETRIC, type FaceSpec } from '../vision/faceTestUtils'
import type { Side } from '../contracts'
import type { Conditions, Expected, ExpectedSide, Recording, RecordingEnv, RecordingKind } from './recording'
import { evaluate, replay, wouldAlert, type Row } from './replay'
import { splitFor, type Split } from './split'

type Capture = ReturnType<typeof makeCapture>
const cache = new Map<string, Capture>()
/** Captures are deterministic per spec, and heavy (478 landmarks x ~70 frames): build each distinct spec once. */
const captureFor = (spec: FaceSpec): Capture => {
  const key = JSON.stringify(spec)
  let c = cache.get(key)
  if (!c) cache.set(key, (c = makeCapture(spec)))
  return c
}

export interface SynthRun {
  subject: string
  scenario: string
  spec: FaceSpec
  expected: Expected
  side?: ExpectedSide
  conditions?: Conditions
  env?: RecordingEnv
  createdAt?: string
}

export function faceRecording(o: SynthRun): Recording {
  const { neutral, smile } = captureFor(o.spec)
  const inputs = { kind: 'face', neutral, smile } as const
  return {
    schema: 1,
    id: `${o.subject}-${o.scenario}`,
    createdAt: o.createdAt ?? '2026-01-01T00:00:00.000Z',
    subject: o.subject,
    scenario: o.scenario,
    expected: o.expected,
    expectedSide: o.side ?? 'none',
    notes: `notes about ${o.subject}`,
    ...(o.conditions ? { conditions: o.conditions } : {}),
    ...(o.env ? { env: o.env } : {}),
    inputs,
    liveResult: replay({ inputs } as Recording),
  }
}

export interface DatasetOptions {
  /** Number of distinct subjects ("s000", "s001", ...). */
  subjects: number
  /** Extra runs injected per subject. Defaults give 2 healthy + 1 borderline + 1 deficit per subject. */
  healthyPerSubject?: number
  deficitPerSubject?: number
  borderlinePerSubject?: number
  /** Called for every run to add conditions/env (e.g. glasses on every third subject). */
  decorate?: (subjectIndex: number, run: SynthRun) => SynthRun
}

const HEALTHY: [string, FaceSpec][] = [
  ['face-healthy', SYMMETRIC],
  ['face-natural-asymmetry', NATURAL_MILD],
]

/** A dataset of synthetic recordings that meets every severity anchor (so it should PASS given enough runs). */
export function syntheticDataset(o: DatasetOptions): Recording[] {
  const { healthyPerSubject = 2, deficitPerSubject = 1, borderlinePerSubject = 1, decorate = (_i, r) => r } = o
  const out: Recording[] = []
  for (let i = 0; i < o.subjects; i++) {
    const subject = `s${String(i).padStart(3, '0')}`
    const runs: SynthRun[] = []
    for (let k = 0; k < healthyPerSubject; k++) {
      const [scenario, spec] = HEALTHY[k % HEALTHY.length]
      runs.push({ subject, scenario, spec, expected: 'healthy' })
    }
    for (let k = 0; k < borderlinePerSubject; k++) runs.push({ subject, scenario: 'face-borderline', spec: BORDERLINE, expected: 'borderline' })
    for (let k = 0; k < deficitPerSubject; k++) {
      const left = (i + k) % 2 === 0
      runs.push({ subject, scenario: left ? 'face-mimic-left-droop' : 'face-mimic-right-droop', spec: left ? droopLeft(1) : droopRight(1), expected: 'deficit', side: left ? 'left' : 'right' })
    }
    for (const r of runs) out.push(faceRecording(decorate(i, r)))
  }
  return out
}

export interface FakeRowOptions {
  expected: Expected
  expectedSide?: ExpectedSide
  severity?: number
  /** Side the analyzer reported (defaults to the expected side). */
  side?: Side
  retry?: boolean
  kind?: RecordingKind
  subject?: string
  scenario?: string
  metrics?: Record<string, number>
  flags?: string[]
  conditions?: Conditions
  env?: RecordingEnv
  split?: Split
}

/** A Row with a hand-picked result (no analyzer run), judged with the real evaluate()/wouldAlert(). Confidence is 1 so severity >= ~0.84 alerts on face/arms. */
export function fakeRow(o: FakeRowOptions): Row {
  const kind = o.kind ?? 'face'
  const expectedSide = o.expectedSide ?? 'none'
  const retry = !!o.retry
  const result = {
    test: kind,
    severity: retry ? 0 : (o.severity ?? 0),
    confidence: retry ? 0.2 : 1,
    metrics: o.metrics ?? {},
    flags: o.flags ?? (retry ? ['move closer'] : []),
    side: o.side ?? expectedSide,
    startedAt: 0,
    durationMs: 1,
    ...(retry ? { needsRetry: true } : {}),
  }
  const subject = o.subject ?? 'fake'
  return {
    file: `${subject}__${o.scenario ?? 'x'}.json`,
    subject,
    kind,
    scenario: o.scenario ?? `${kind}-${o.expected}`,
    expected: o.expected,
    expectedSide,
    result,
    liveSeverity: result.severity,
    verdict: evaluate({ expected: o.expected, expectedSide }, result),
    alert: wouldAlert(result),
    split: o.split ?? splitFor(subject),
    conditions: o.conditions,
    env: o.env,
  }
}
