// Recording schema for calibration: the EXACT inputs handed to an analyzer plus what the live app scored, so a run can be
// replayed offline through the same pure functions (see replay.ts, `pnpm calibrate`). Landmarks only, no video/images.
import type { TestResult } from '../contracts'
import type { EyeFrame } from '../vision/eyes'
import type { FaceCaptureFrame } from '../vision/face'
import type { PoseFrame } from '../vision/landmarks'

export type RecordingKind = 'face' | 'arms' | 'eyes'
export type Expected = 'healthy' | 'borderline' | 'deficit'
/** The PATIENT'S own side that is deficient ("left" = the recorded person's left). 'none' for healthy/borderline. */
export type ExpectedSide = 'none' | 'left' | 'right'

export type RecordingInputs =
  | { kind: 'face'; neutral: FaceCaptureFrame[]; smile: FaceCaptureFrame[] }
  | { kind: 'arms'; frames: PoseFrame[]; aspectRatio: number }
  | { kind: 'eyes'; frames: EyeFrame[]; aspect: number }

export type Lighting = 'bright' | 'normal' | 'dim'
export type MicKind = 'laptop' | 'headset' | 'external'
export type NoiseLevel = 'quiet' | 'moderate' | 'loud'

/** Structured recording conditions (vision + speech share one type; each side fills its own keys). Every key optional/nullable. */
export interface Conditions {
  glasses?: boolean | null
  facialHair?: boolean | null
  lighting?: Lighting | null
  distanceM?: number | null
  device?: string | null // camera/laptop model, short free text
  mic?: MicKind | null
  noise?: NoiseLevel | null
  nativeEnglish?: boolean | null
}

/** Auto-collected capture environment. Vision fills delegate/fps/videoSize; speech fills the track settings. */
export interface RecordingEnv {
  userAgent?: string
  hardwareConcurrency?: number
  deviceMemoryGB?: number | null
  screen?: string
  delegate?: string | null
  fps?: number | null
  videoSize?: string | null
  sampleRate?: number | null
  echoCancellation?: boolean | null
  noiseSuppression?: boolean | null
  autoGainControl?: boolean | null
}

export const LIGHTING_VALUES: readonly Lighting[] = ['bright', 'normal', 'dim']
export const MIC_VALUES: readonly MicKind[] = ['laptop', 'headset', 'external']
export const NOISE_VALUES: readonly NoiseLevel[] = ['quiet', 'moderate', 'loud']

const bool = (v: unknown): boolean | null | undefined => (typeof v === 'boolean' || v === null ? v : undefined)
const num = (v: unknown): number | null | undefined => (v === null || (typeof v === 'number' && Number.isFinite(v)) ? v : undefined)
const str = (v: unknown): string | null | undefined => (v === null || typeof v === 'string' ? v : undefined)
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null | undefined =>
  v === null ? null : typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined
const compact = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T

/** Tolerant reader: unknown keys are dropped, wrongly-typed values are dropped, anything that is not an object gives undefined. */
export function sanitizeConditions(raw: unknown): Conditions | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  return compact<Conditions>({
    glasses: bool(r.glasses),
    facialHair: bool(r.facialHair),
    lighting: oneOf(r.lighting, LIGHTING_VALUES),
    distanceM: num(r.distanceM),
    device: str(r.device),
    mic: oneOf(r.mic, MIC_VALUES),
    noise: oneOf(r.noise, NOISE_VALUES),
    nativeEnglish: bool(r.nativeEnglish),
  })
}

/** Tolerant reader for `env`, same rules as sanitizeConditions. */
export function sanitizeEnv(raw: unknown): RecordingEnv | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  const s = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  return compact<RecordingEnv>({
    userAgent: s(r.userAgent),
    hardwareConcurrency: n(r.hardwareConcurrency),
    deviceMemoryGB: num(r.deviceMemoryGB),
    screen: s(r.screen),
    delegate: str(r.delegate),
    fps: num(r.fps),
    videoSize: str(r.videoSize),
    sampleRate: num(r.sampleRate),
    echoCancellation: bool(r.echoCancellation),
    noiseSuppression: bool(r.noiseSuppression),
    autoGainControl: bool(r.autoGainControl),
  })
}

export interface Recording {
  schema: 1
  id: string
  createdAt: string // ISO
  subject: string // anonymous id/nickname of the person recorded, e.g. "sam"
  scenario: string // Scenario.id, e.g. "face-mimic-left-droop"
  expected: Expected
  expectedSide: ExpectedSide
  notes: string
  /** Optional (old files have none): structured conditions for the per-condition validation breakdown. */
  conditions?: Conditions
  /** Optional: auto-collected device/browser environment. */
  env?: RecordingEnv
  inputs: RecordingInputs
  /** What the live app computed at record time (for comparing with later replays after threshold changes). */
  liveResult: TestResult
}

export interface Scenario {
  id: string
  kind: RecordingKind
  label: string
  expected: Expected
  side: ExpectedSide
  /** Shown to the person being recorded. */
  instructions: string
}

// Only face + arms are wired to the runner today. Add eyes scenarios when runEyes exists (schema already supports 'eyes').
export const SCENARIOS: Scenario[] = [
  { id: 'face-healthy', kind: 'face', label: 'Face: normal smile', expected: 'healthy', side: 'none', instructions: 'Relax, then smile as big as you normally would.' },
  { id: 'face-natural-asymmetry', kind: 'face', label: 'Face: naturally lopsided smile', expected: 'healthy', side: 'none', instructions: 'Smile the way you naturally do, even if it is a bit lopsided. Do NOT exaggerate.' },
  { id: 'face-mimic-left-droop', kind: 'face', label: "Face: MIMIC droop on YOUR left", expected: 'deficit', side: 'left', instructions: "Smile, but let the corner of YOUR LEFT side barely lift (droop it). Right side smiles normally." },
  { id: 'face-mimic-right-droop', kind: 'face', label: "Face: MIMIC droop on YOUR right", expected: 'deficit', side: 'right', instructions: "Smile, but let the corner of YOUR RIGHT side barely lift (droop it). Left side smiles normally." },
  { id: 'arms-healthy', kind: 'arms', label: 'Arms: hold both steady', expected: 'healthy', side: 'none', instructions: 'Hold both arms straight out to your sides for the whole 10 s.' },
  { id: 'arms-fatigue-both', kind: 'arms', label: 'Arms: both sink a little equally', expected: 'healthy', side: 'none', instructions: 'Hold both arms out, and let BOTH slowly sink a little (like getting tired), equally.' },
  { id: 'arms-mimic-left-drop', kind: 'arms', label: 'Arms: MIMIC YOUR left arm drifting down', expected: 'deficit', side: 'left', instructions: 'Raise both arms, then let YOUR LEFT arm slowly sink for the rest of the hold. Right arm stays up.' },
  { id: 'arms-mimic-right-drop', kind: 'arms', label: 'Arms: MIMIC YOUR right arm drifting down', expected: 'deficit', side: 'right', instructions: 'Raise both arms, then let YOUR RIGHT arm slowly sink for the rest of the hold. Left arm stays up.' },
  { id: 'arms-mimic-left-never-raised', kind: 'arms', label: 'Arms: MIMIC YOUR left arm cannot lift', expected: 'deficit', side: 'left', instructions: 'Raise ONLY your right arm; keep YOUR LEFT arm down at your side.' },
  { id: 'arms-mimic-right-never-raised', kind: 'arms', label: 'Arms: MIMIC YOUR right arm cannot lift', expected: 'deficit', side: 'right', instructions: 'Raise ONLY your left arm; keep YOUR RIGHT arm down at your side.' },
]

export const scenariosFor = (kind: RecordingKind): Scenario[] => SCENARIOS.filter((s) => s.kind === kind)
export const findScenario = (id: string): Scenario | undefined => SCENARIOS.find((s) => s.id === id)

const DP = 4
const round = (x: number): number => Math.round(x * 10 ** DP) / 10 ** DP || 0 // || 0 turns -0 into 0

/** Round every number to 4 decimals (keeps a face capture around 0.8-1 MB of JSON (measured: 765 KB for 67 frames)). Returns a new structure. */
export function roundDeep<T>(value: T): T {
  if (typeof value === 'number') return (Number.isFinite(value) ? round(value) : value) as T
  if (Array.isArray(value)) return value.map(roundDeep) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundDeep(v)])) as T
  }
  return value
}

export const serializeRecording = (rec: Recording): string => JSON.stringify(roundDeep(rec))

const KINDS: RecordingKind[] = ['face', 'arms', 'eyes']
const EXPECTED: Expected[] = ['healthy', 'borderline', 'deficit']
const SIDES: ExpectedSide[] = ['none', 'left', 'right']

/** Validate an already-parsed JSON value. Throws a readable Error on anything that isn't a schema-1 recording. */
export function validateRecording(raw: unknown, source = 'recording'): Recording {
  const r = raw as Partial<Recording> | null
  const fail = (why: string): never => {
    throw new Error(`${source}: ${why}`)
  }
  if (!r || typeof r !== 'object') return fail('not an object')
  if (r.schema !== 1) return fail(`unsupported schema ${String(r.schema)}`)
  if (!r.inputs || !KINDS.includes(r.inputs.kind)) return fail('missing/invalid inputs.kind')
  if (!r.expected || !EXPECTED.includes(r.expected)) return fail('invalid expected')
  if (!r.expectedSide || !SIDES.includes(r.expectedSide)) return fail('invalid expectedSide')
  const i = r.inputs
  if (i.kind === 'face' && !(Array.isArray(i.neutral) && Array.isArray(i.smile))) return fail('face inputs need neutral[] and smile[]')
  if (i.kind === 'arms' && !(Array.isArray(i.frames) && typeof i.aspectRatio === 'number')) return fail('arms inputs need frames[] and aspectRatio')
  if (i.kind === 'eyes' && !(Array.isArray(i.frames) && typeof i.aspect === 'number')) return fail('eyes inputs need frames[] and aspect')
  const out = { ...r } as Recording
  // Optional, tolerant: absent or malformed conditions/env never make a recording unreadable.
  const conditions = sanitizeConditions(r.conditions)
  const env = sanitizeEnv(r.env)
  if (conditions) out.conditions = conditions
  else delete out.conditions
  if (env) out.env = env
  else delete out.env
  return out
}

export const parseRecording = (text: string, source?: string): Recording => validateRecording(JSON.parse(text), source)

const slug = (s: string): string => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'anon'

export const recordingFileName = (rec: Pick<Recording, 'subject' | 'scenario' | 'createdAt'>): string =>
  `${slug(rec.subject)}__${slug(rec.scenario)}__${rec.createdAt.replace(/[:.]/g, '-')}.json`
