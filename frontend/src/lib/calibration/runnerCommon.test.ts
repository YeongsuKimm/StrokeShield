/// <reference types="node" />
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { serializeRecording } from './recording'
import { loadRows, readSplitOverride } from './runnerCommon'
import { faceRecording } from './syntheticRecordings'
import { SYMMETRIC } from '../vision/faceTestUtils'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'rows-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const rec = (subject: string) => faceRecording({ subject, scenario: 'face-healthy', spec: { ...SYMMETRIC, nNeutral: 8, nSmile: 12 }, expected: 'healthy' })

describe('loadRows (node-side loader)', () => {
  it('reads recordings recursively, tags splits, honours split.json, skips it as a recording, reports bad files', () => {
    const dir = tmp()
    mkdirSync(join(dir, 'nested'))
    writeFileSync(join(dir, 'a.json'), serializeRecording(rec('sam'))) // hash: validate
    writeFileSync(join(dir, 'nested', 'b.json'), serializeRecording(rec('alex'))) // hash: tune
    writeFileSync(join(dir, 'bad.json'), '{ nope')
    writeFileSync(join(dir, 'split.json'), JSON.stringify({ tune: ['sam'], validate: ['alex'] }))
    const override = readSplitOverride(dir)
    expect(override).toEqual({ tune: ['sam'], validate: ['alex'] })

    const withOverride = loadRows([dir], override)
    expect(withOverride.rows.map((r) => [r.file.replace(/\\/g, '/'), r.split]).sort()).toEqual([
      ['a.json', 'tune'],
      ['nested/b.json', 'validate'],
    ])
    expect(withOverride.errors).toHaveLength(1)
    expect(withOverride.errors[0]).toMatch(/bad\.json|Expected|JSON/)

    const byHash = loadRows([dir], null)
    expect(byHash.rows.find((r) => r.subject === 'sam')?.split).toBe('validate')
    expect(byHash.rows.find((r) => r.subject === 'alex')?.split).toBe('tune')
  })

  it('a missing directory or split.json is fine; a contradictory split.json is an error', () => {
    expect(loadRows([join(tmpdir(), 'does-not-exist-xyz')], null).rows).toEqual([])
    const dir = tmp()
    expect(readSplitOverride(dir)).toBeNull()
    writeFileSync(join(dir, 'split.json'), JSON.stringify({ tune: ['a'], validate: ['A'] }))
    expect(() => readSplitOverride(dir)).toThrow(/both tune and validate/)
  })
})
