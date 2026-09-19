// Finds recordings via Vite's import.meta.glob (works in vitest, no fs/node types needed).
//  - committed:  src/lib/calibration/fixtures/recordings/**/*.json  (consented, shared; run by `pnpm test` as regression)
//  - personal:   frontend/recordings/**/*.json                       (gitignored; only used by `pnpm calibrate`)
import { validateRecording, type Recording } from './recording'

type Loader = () => Promise<unknown>

const committed = import.meta.glob('./fixtures/recordings/**/*.json', { import: 'default' }) as Record<string, Loader>
const personal = import.meta.glob('../../../recordings/**/*.json', { import: 'default' }) as Record<string, Loader>

export interface Loaded {
  file: string
  rec: Recording
}

async function load(globbed: Record<string, Loader>): Promise<{ ok: Loaded[]; errors: string[] }> {
  const ok: Loaded[] = []
  const errors: string[] = []
  for (const [file, loader] of Object.entries(globbed).sort(([a], [b]) => a.localeCompare(b))) {
    if (/(^|\/)split\.json$/.test(file)) continue // the split override is not a recording
    const short = file.replace(/^.*recordings\//, '')
    try {
      ok.push({ file: short, rec: validateRecording(await loader(), short) })
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  return { ok, errors }
}

export const loadCommitted = (): ReturnType<typeof load> => load(committed)
export const loadPersonal = (): ReturnType<typeof load> => load(personal)
