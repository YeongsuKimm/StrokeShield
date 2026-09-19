// Deterministic subject-level tune/validate split (no leakage: every run of a person lands on the same side).
// Shared spec with the Python speech validator (models/validate.py): bucket = int(sha1(subject.strip().lower())[:8], 16) % 100;
// bucket < 60 -> 'tune', else 'validate'. An optional recordings/split.json override wins. Pure; this is tooling, keep it
// out of browser code paths.
import { sha1Hex } from './sha'

export type Split = 'tune' | 'validate'
export const TUNE_BUCKETS = 60

export interface SplitOverride {
  tune?: string[]
  validate?: string[]
}

export const normalizeSubject = (subject: string): string => subject.trim().toLowerCase()

export const bucketOf = (subject: string): number => parseInt(sha1Hex(normalizeSubject(subject)).slice(0, 8), 16) % 100

/** Validate + normalize a parsed split.json. Throws on a subject listed in both lists or on a malformed file. */
export function parseSplitOverride(raw: unknown, source = 'split.json'): SplitOverride {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${source}: expected {"tune": [...], "validate": [...]}`)
  const r = raw as Record<string, unknown>
  const list = (key: 'tune' | 'validate'): string[] => {
    const v = r[key]
    if (v === undefined) return []
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new Error(`${source}: "${key}" must be an array of strings`)
    return (v as string[]).map(normalizeSubject)
  }
  const tune = list('tune')
  const validate = list('validate')
  const both = tune.filter((s) => validate.includes(s))
  if (both.length) throw new Error(`${source}: subject listed in both tune and validate: ${[...new Set(both)].join(', ')}`)
  return { tune, validate }
}

/** The split a subject belongs to. `override` (parsed with parseSplitOverride) wins over the hash rule. */
export function splitFor(subject: string, override?: SplitOverride | null): Split {
  const s = normalizeSubject(subject)
  if (override?.tune?.some((x) => normalizeSubject(x) === s)) return 'tune'
  if (override?.validate?.some((x) => normalizeSubject(x) === s)) return 'validate'
  return bucketOf(s) < TUNE_BUCKETS ? 'tune' : 'validate'
}
