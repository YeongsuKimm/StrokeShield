import { describe, expect, it } from 'vitest'
import { canonicalJson, diffConfig, freezeStatus, hashConfig, parseFreezeFile, snapshotConfig, visionFreezeConfig, type FreezeFile } from './freeze'

describe('canonicalJson', () => {
  it('sorts keys recursively, keeps array order, no whitespace', () => {
    const a = canonicalJson({ b: 1, a: { d: [3, 1, 2], c: 'x' } })
    expect(a.json).toBe('{"a":{"c":"x","d":[3,1,2]},"b":1}')
    expect(canonicalJson({ a: { c: 'x', d: [3, 1, 2] }, b: 1 }).json).toBe(a.json)
    expect(a.skipped).toEqual([])
  })

  it('skips non-serialisable values and says where', () => {
    const c = canonicalJson({ ok: 1, fn: () => 1, re: /x/, nan: NaN, undef: undefined, arr: [1, () => 2, 3] })
    expect(c.json).toBe('{"arr":[1,null,3],"ok":1}')
    expect([...c.skipped].sort()).toEqual(['$.arr[1]', '$.fn', '$.nan', '$.re', '$.undef'].sort())
  })

  it('hash is 16 hex chars and is order independent', () => {
    expect(hashConfig({ a: 1, b: 2 })).toMatch(/^[0-9a-f]{16}$/)
    expect(hashConfig({ a: 1, b: 2 })).toBe(hashConfig({ b: 2, a: 1 }))
    expect(hashConfig({ a: 1 })).not.toBe(hashConfig({ a: 2 }))
  })
})

describe('vision freeze config', () => {
  it('contains all seven threshold blocks and serialises without skips', () => {
    const cfg = visionFreezeConfig()
    expect(Object.keys(cfg).sort()).toEqual(['ARMS_CONFIG', 'EYES_CONFIG', 'FACE_CONFIG', 'FRAMING_LIMITS', 'MAX_WEIGHTS', 'MIN_CONFIDENCE', 'RISK_THRESHOLD'])
    const snap = snapshotConfig()
    expect(snap.skipped).toEqual([])
    expect(snap.hash).toMatch(/^[0-9a-f]{16}$/)
    expect(snapshotConfig().hash).toBe(snap.hash) // stable
  })
})

describe('freezeStatus transitions', () => {
  const current = snapshotConfig()
  const fileFor = (config: unknown, over: Partial<FreezeFile> = {}): FreezeFile => ({
    frozenAt: '2026-09-19T10:00:00.000Z',
    gitCommit: 'abcdef1234567890',
    hash: hashConfig(config),
    config: snapshotConfig(config).config,
    ...over,
  })

  it('none: no freeze file', () => {
    const s = freezeStatus(null, current)
    expect(s.state).toBe('none')
    expect(s.text).toBe('Thresholds frozen: NO freeze file (run `pnpm freeze` after tuning, before validating)')
  })

  it('matches: same config as the freeze', () => {
    const s = freezeStatus(fileFor(visionFreezeConfig()), current)
    expect(s.state).toBe('matches')
    expect(s.text).toBe('Thresholds frozen: YES (hash matches, frozen 2026-09-19 at abcdef1234)')
  })

  it('unknown commit is stated', () => {
    expect(freezeStatus(fileFor(visionFreezeConfig(), { gitCommit: null }), current).text).toMatch(/at unknown commit\)/)
  })

  it('changed: a threshold moved after the freeze; both hashes and the changed values are shown', () => {
    const edited = JSON.parse(JSON.stringify(visionFreezeConfig())) as { FACE_CONFIG: { minSmilePeak: number } }
    edited.FACE_CONFIG.minSmilePeak = 0.31
    const frozen = fileFor(edited) // frozen with different numbers than the code has now
    const s = freezeStatus(frozen, current)
    expect(s.state).toBe('changed')
    expect(s.text).toBe(`Thresholds frozen: NO: config changed since freeze (frozen ${frozen.hash} vs current ${current.hash}) so this is NOT independent evidence`)
    expect(s.details.some((d) => d.includes('$.FACE_CONFIG.minSmilePeak'))).toBe(true)
  })

  it('invalid: a freeze file whose hash was edited by hand', () => {
    const s = freezeStatus(fileFor(visionFreezeConfig(), { hash: '0000000000000000' }), current)
    expect(s.state).toBe('invalid')
    expect(s.text).toMatch(/NOT independent evidence/)
  })

  it('reports values that could not be hashed', () => {
    const s = freezeStatus(fileFor({ a: 1 }), snapshotConfig({ a: 1, f: () => 1 }))
    expect(s.state).toBe('matches')
    expect(s.details.join(' ')).toMatch(/Not JSON-serialisable.*\$\.f/)
  })
})

describe('diffConfig / parseFreezeFile', () => {
  it('lists changed, added and removed leaves', () => {
    expect(diffConfig({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 }, d: 4 })).toEqual(['$.b.c: 2 -> 3', '$.d: (absent) -> 4'])
    expect(diffConfig({ a: 1 }, { a: 1 })).toEqual([])
  })
  it('validates the file shape', () => {
    expect(() => parseFreezeFile({ hash: 'x' })).toThrow(/expected/)
    expect(parseFreezeFile({ frozenAt: 't', hash: 'h', config: {} }).gitCommit).toBeNull()
  })
})
