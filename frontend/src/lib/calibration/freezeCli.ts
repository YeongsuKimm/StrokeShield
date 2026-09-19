/// <reference types="node" />
// NODE ONLY (fs + git): reads/writes docs/validation/frozen-vision.json. Used by `pnpm freeze` / `pnpm validate`; never
// import this from browser code. The pure logic is in freeze.ts.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFreezeFile, snapshotConfig, type FreezeFile, type FreezeSnapshot } from './freeze'

/** Repo root: this file is frontend/src/lib/calibration/. */
export const repoRoot = (): string => resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
export const frozenVisionPath = (): string => resolve(repoRoot(), 'docs/validation/frozen-vision.json')

/** `git rev-parse HEAD`, or null if git is unavailable / not a repo. */
export function currentGitCommit(cwd: string = repoRoot()): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}

/** null when the file does not exist; throws a readable Error when it exists but is malformed. */
export function readFreeze(path: string = frozenVisionPath()): FreezeFile | null {
  if (!existsSync(path)) return null
  try {
    return parseFreezeFile(JSON.parse(readFileSync(path, 'utf8')), path)
  } catch (e) {
    throw new Error(`cannot read freeze file ${path}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export interface WriteFreezeOptions {
  path?: string
  now?: Date
  /** Injectable for tests; defaults to `git rev-parse HEAD`. */
  gitCommit?: () => string | null
  snapshot?: FreezeSnapshot
}

/** Write the freeze file (creating docs/validation/) and return it. */
export function writeFreeze(opts: WriteFreezeOptions = {}): { file: FreezeFile; path: string; skipped: string[] } {
  const path = opts.path ?? frozenVisionPath()
  const snap = opts.snapshot ?? snapshotConfig()
  const file: FreezeFile = { frozenAt: (opts.now ?? new Date()).toISOString(), gitCommit: (opts.gitCommit ?? currentGitCommit)(), hash: snap.hash, config: snap.config }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`)
  return { file, path, skipped: snap.skipped }
}
