/// <reference types="node" />
// NODE ONLY. Shared by the `pnpm calibrate|tune|validate` runners: read every recording (committed fixtures + personal
// frontend/recordings/) with node:fs, analyse it right away and keep only the small analysed Row, so memory stays flat
// (a face recording is ~0.8 MB of landmarks; loading hundreds through Vite's module graph runs out of memory).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateRecording } from './recording'
import { analyzeRow, type Row } from './replay'
import { parseSplitOverride, type SplitOverride } from './split'

const here = dirname(fileURLToPath(import.meta.url)) // frontend/src/lib/calibration
export const committedDir = (): string => join(here, 'fixtures', 'recordings')
export const personalDir = (): string => resolve(here, '../../../recordings') // frontend/recordings (gitignored)

export interface LoadedRows {
  rows: Row[]
  /** Unreadable files (reported, and fail the run). */
  errors: string[]
  override: SplitOverride | null
}

const jsonFilesIn = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((f) => f.endsWith('.json') && !/(^|[\\/])split\.json$/.test(f))
        .sort()
    : []

/** recordings/split.json parsed and validated, or null when absent. Throws on a malformed file or a subject in both lists. */
export function readSplitOverride(dir: string = personalDir()): SplitOverride | null {
  const path = join(dir, 'split.json')
  if (!existsSync(path)) return null
  return parseSplitOverride(JSON.parse(readFileSync(path, 'utf8')), 'recordings/split.json')
}

export function loadRows(dirs: string[] = [committedDir(), personalDir()], override: SplitOverride | null = readSplitOverride()): LoadedRows {
  const rows: Row[] = []
  const errors: string[] = []
  for (const dir of dirs) {
    for (const rel of jsonFilesIn(dir)) {
      try {
        const rec = validateRecording(JSON.parse(readFileSync(join(dir, rel), 'utf8')), rel)
        rows.push(analyzeRow(rec, rel, override))
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `${rel}: ${String(e)}`)
      }
    }
  }
  return { rows, errors, override }
}

export const NO_RECORDINGS_MESSAGE =
  '\nNo recordings found. Record people with http://localhost:5173/?record=1 and put the .json files in frontend/recordings/ (see docs/CALIBRATION.md, "Validation").\n'

export const overrideCounts = (o: SplitOverride | null): { tune: number; validate: number } | null => (o ? { tune: o.tune?.length ?? 0, validate: o.validate?.length ?? 0 } : null)
