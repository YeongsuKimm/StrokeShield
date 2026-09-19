/// <reference types="node" />
// `pnpm freeze`: record the hash of ALL vision thresholds in docs/validation/frozen-vision.json. Do this when tuning is
// finished and BEFORE running `pnpm validate`; any later threshold edit makes the hash differ and the validation report says so.
import { describe, it } from 'vitest'
import { snapshotConfig, type FreezeFile } from './freeze'
import { readFreeze, writeFreeze } from './freezeCli'

describe('vision threshold freeze', () => {
  it('writes docs/validation/frozen-vision.json', () => {
    const snap = snapshotConfig()
    let previous: FreezeFile | null = null
    try {
      previous = readFreeze()
    } catch (e) {
      console.log(`(existing freeze file unreadable, overwriting: ${e instanceof Error ? e.message : String(e)})`)
    }
    const { file, path, skipped } = writeFreeze({ snapshot: snap })
    console.log(`\nFroze vision thresholds: hash ${file.hash} at commit ${file.gitCommit ?? 'unknown (git not available)'}`)
    console.log(`Written to ${path}`)
    if (previous && previous.hash !== file.hash) console.log(`Replaced an earlier freeze (${previous.hash}, ${previous.frozenAt}). Validation evidence gathered under it is superseded.`)
    if (previous && previous.hash === file.hash) console.log('Same hash as the earlier freeze: thresholds are unchanged since then.')
    if (skipped.length) console.log(`Not JSON-serialisable, left out of the hash: ${skipped.join(', ')}`)
    console.log('Commit docs/validation/frozen-vision.json so the freeze is on record BEFORE you run `pnpm validate`.\n')
  })
})
