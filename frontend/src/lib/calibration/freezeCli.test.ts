/// <reference types="node" />
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { freezeStatus, snapshotConfig, visionFreezeConfig } from './freeze'
import { readFreeze, writeFreeze } from './freezeCli'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'freeze-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('freeze file round trip (node)', () => {
  it('creates missing directories, writes the documented shape, and reads it back as "matches"', () => {
    const path = join(tmp(), 'docs', 'validation', 'frozen-vision.json')
    expect(readFreeze(path)).toBeNull()
    const { file } = writeFreeze({ path, now: new Date('2026-09-19T12:00:00.000Z'), gitCommit: () => '0123456789abcdef' })
    const onDisk = JSON.parse(readFileSync(path, 'utf8'))
    expect(Object.keys(onDisk).sort()).toEqual(['config', 'frozenAt', 'gitCommit', 'hash'])
    expect(onDisk).toMatchObject({ frozenAt: '2026-09-19T12:00:00.000Z', gitCommit: '0123456789abcdef', hash: file.hash })
    expect(Object.keys(onDisk.config).sort()).toEqual(Object.keys(visionFreezeConfig()).sort())
    expect(freezeStatus(readFreeze(path)).state).toBe('matches')
  })

  it('stores a null commit when git is unavailable', () => {
    const path = join(tmp(), 'f.json')
    expect(writeFreeze({ path, gitCommit: () => null }).file.gitCommit).toBeNull()
    expect(readFreeze(path)?.gitCommit).toBeNull()
  })

  it('a config edit after the freeze flips the status to "changed"', () => {
    const path = join(tmp(), 'f.json')
    const cfg = visionFreezeConfig()
    writeFreeze({ path, gitCommit: () => null, snapshot: snapshotConfig({ ...cfg, RISK_THRESHOLD: 0.4 }) })
    const s = freezeStatus(readFreeze(path))
    expect(s.state).toBe('changed')
    expect(s.details.join('\n')).toMatch(/RISK_THRESHOLD/)
  })

  it('a malformed freeze file gives a readable error', () => {
    const path = join(tmp(), 'bad.json')
    writeFileSync(path, '{ not json')
    expect(() => readFreeze(path)).toThrow(/cannot read freeze file/)
  })
})
