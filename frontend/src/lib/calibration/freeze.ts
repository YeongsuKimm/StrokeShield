// "Freeze": a hash of ALL vision thresholds so validation evidence can prove the numbers were not tuned afterwards.
// Pure (no fs/git): canonical JSON + sha256, the freeze-file shape, and the status comparison. Writing/reading the file
// and calling git live in freezeCli.ts (node only). Shared spec with the Python speech validator.
import { FRAMING_LIMITS, MAX_WEIGHTS, MIN_CONFIDENCE, RISK_THRESHOLD } from '../config'
import { ARMS_CONFIG } from '../vision/arms'
import { EYES_CONFIG } from '../vision/eyes'
import { FACE_CONFIG } from '../vision/face'
import { sha256Hex } from './sha'

export interface Canonical {
  json: string
  /** Paths (`$.FACE_CONFIG.foo`) of values that are not JSON-serialisable (functions, regexes, NaN, undefined...) and were left out. */
  skipped: string[]
}

const isPlainObject = (v: object): boolean => {
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** Canonical JSON: recursively sorted keys, arrays in order, numbers as-is, no whitespace. Non-serialisable values are skipped and reported. */
export function canonicalJson(value: unknown): Canonical {
  const skipped: string[] = []
  const walk = (v: unknown, path: string): string | undefined => {
    if (v === null) return 'null'
    switch (typeof v) {
      case 'boolean':
      case 'string':
        return JSON.stringify(v)
      case 'number':
        if (Number.isFinite(v)) return JSON.stringify(v)
        skipped.push(path)
        return undefined
      case 'object': {
        if (Array.isArray(v)) {
          return `[${v
            .map((x, i) => {
              const s = walk(x, `${path}[${i}]`)
              return s ?? 'null' // keep positions stable; the skip is reported
            })
            .join(',')}]`
        }
        if (!isPlainObject(v)) {
          skipped.push(path)
          return undefined
        }
        const parts: string[] = []
        for (const key of Object.keys(v).sort()) {
          const s = walk((v as Record<string, unknown>)[key], `${path}.${key}`)
          if (s !== undefined) parts.push(`${JSON.stringify(key)}:${s}`)
        }
        return `{${parts.join(',')}}`
      }
      default:
        skipped.push(path)
        return undefined
    }
  }
  return { json: walk(value, '$') ?? 'null', skipped }
}

/** First 16 hex chars of the sha256 of the canonical JSON. */
export const hashConfig = (value: unknown): string => sha256Hex(canonicalJson(value).json).slice(0, 16)

/** Everything that decides a vision result or the alert: per-test configs, framing gates, risk weights/threshold, retry cutoff. */
export const visionFreezeConfig = (): Record<string, unknown> => ({
  FACE_CONFIG,
  ARMS_CONFIG,
  EYES_CONFIG,
  FRAMING_LIMITS,
  MAX_WEIGHTS,
  RISK_THRESHOLD,
  MIN_CONFIDENCE,
})

export interface FreezeFile {
  frozenAt: string // ISO
  gitCommit: string | null
  hash: string
  config: unknown
}

export interface FreezeSnapshot {
  hash: string
  /** The exact (JSON-round-tripped) object that was hashed, safe to write to disk. */
  config: unknown
  skipped: string[]
}

export function snapshotConfig(config: unknown = visionFreezeConfig()): FreezeSnapshot {
  const c = canonicalJson(config)
  return { hash: sha256Hex(c.json).slice(0, 16), config: JSON.parse(c.json), skipped: c.skipped }
}

export type FreezeState = 'matches' | 'changed' | 'none' | 'invalid'

export interface FreezeStatus {
  state: FreezeState
  /** One line for the report header, always starting with "Thresholds frozen:". */
  text: string
  /** Extra lines: which values changed, skipped values. */
  details: string[]
}

const leaves = (v: unknown, path: string, out: Map<string, string>): void => {
  if (v && typeof v === 'object') {
    if (Array.isArray(v)) v.forEach((x, i) => leaves(x, `${path}[${i}]`, out))
    else for (const [k, x] of Object.entries(v)) leaves(x, `${path}.${k}`, out)
  } else out.set(path, JSON.stringify(v))
}

/** Leaf paths whose value differs between two configs (added/removed included). */
export function diffConfig(a: unknown, b: unknown, limit = 25): string[] {
  const ma = new Map<string, string>()
  const mb = new Map<string, string>()
  leaves(a, '$', ma)
  leaves(b, '$', mb)
  const out: string[] = []
  for (const key of [...new Set([...ma.keys(), ...mb.keys()])].sort()) {
    if (ma.get(key) !== mb.get(key)) out.push(`${key}: ${ma.get(key) ?? '(absent)'} -> ${mb.get(key) ?? '(absent)'}`)
  }
  return out.length > limit ? [...out.slice(0, limit), `... and ${out.length - limit} more`] : out
}

const shortCommit = (c: string | null): string => (c ? c.slice(0, 10) : 'unknown commit')

/** Compare a freeze file (or null) with the current config snapshot. */
export function freezeStatus(file: FreezeFile | null, current: FreezeSnapshot = snapshotConfig()): FreezeStatus {
  const skippedNote = current.skipped.length ? [`Not JSON-serialisable, left out of the hash: ${current.skipped.join(', ')}`] : []
  if (!file) return { state: 'none', text: 'Thresholds frozen: NO freeze file (run `pnpm freeze` after tuning, before validating)', details: skippedNote }
  if (hashConfig(file.config) !== file.hash) {
    return { state: 'invalid', text: 'Thresholds frozen: NO: freeze file is inconsistent (its hash does not match its own config; edited by hand?) so this is NOT independent evidence', details: skippedNote }
  }
  if (file.hash === current.hash) {
    return { state: 'matches', text: `Thresholds frozen: YES (hash matches, frozen ${file.frozenAt.slice(0, 10)} at ${shortCommit(file.gitCommit)})`, details: skippedNote }
  }
  return {
    state: 'changed',
    text: `Thresholds frozen: NO: config changed since freeze (frozen ${file.hash} vs current ${current.hash}) so this is NOT independent evidence`,
    details: [...diffConfig(file.config, current.config).map((d) => `changed ${d}`), ...skippedNote],
  }
}

/** Structural check of a parsed freeze file (JSON from disk). Throws a readable Error. */
export function parseFreezeFile(raw: unknown, source = 'freeze file'): FreezeFile {
  const r = raw as Partial<FreezeFile> | null
  if (!r || typeof r !== 'object' || typeof r.hash !== 'string' || typeof r.frozenAt !== 'string' || !('config' in r)) {
    throw new Error(`${source}: expected { frozenAt, gitCommit, hash, config }`)
  }
  return { frozenAt: r.frozenAt, gitCommit: typeof r.gitCommit === 'string' ? r.gitCommit : null, hash: r.hash, config: r.config }
}
