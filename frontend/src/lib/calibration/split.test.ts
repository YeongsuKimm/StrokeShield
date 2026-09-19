import { describe, expect, it } from 'vitest'
import { bucketOf, parseSplitOverride, splitFor } from './split'

describe('subject split', () => {
  it('matches the shared spec test vectors', () => {
    const vectors: [string, number, 'tune' | 'validate'][] = [
      ['sam', 66, 'validate'],
      ['alex', 43, 'tune'],
      ['jo', 67, 'validate'],
      ['Sam ', 66, 'validate'],
      ['anon', 53, 'tune'],
      ['maria', 72, 'validate'],
      ['li', 60, 'validate'],
      ['omar', 25, 'tune'],
      ['priya', 49, 'tune'],
      ['tom', 40, 'tune'],
    ]
    for (const [subject, bucket, split] of vectors) {
      expect(bucketOf(subject), subject).toBe(bucket)
      expect(splitFor(subject), subject).toBe(split)
    }
  })

  it('is case- and whitespace-insensitive and stable across calls', () => {
    expect(splitFor('  SAM')).toBe(splitFor('sam'))
    expect(splitFor('Alex')).toBe(splitFor('alex '))
    expect(Array.from({ length: 5 }, () => splitFor('maria'))).toEqual(Array(5).fill('validate'))
  })

  it('assigns roughly 60 % of many subjects to tune', () => {
    const n = 1000
    const tune = Array.from({ length: n }, (_, i) => splitFor(`subject-${i}`)).filter((s) => s === 'tune').length
    expect(tune / n).toBeGreaterThan(0.53)
    expect(tune / n).toBeLessThan(0.67)
  })

  it('override wins, normalized like subjects', () => {
    const o = parseSplitOverride({ tune: ['Sam '], validate: ['ALEX'] })
    expect(splitFor('sam', o)).toBe('tune')
    expect(splitFor('alex', o)).toBe('validate')
    expect(splitFor('maria', o)).toBe('validate') // not listed -> hash rule
    expect(splitFor('tom', o)).toBe('tune')
  })

  it('a subject listed in both lists is an error; malformed files are rejected', () => {
    expect(() => parseSplitOverride({ tune: ['a', 'B'], validate: ['b '] })).toThrow(/both tune and validate: b/)
    expect(() => parseSplitOverride(null)).toThrow(/expected/)
    expect(() => parseSplitOverride({ tune: 'x' })).toThrow(/array of strings/)
    expect(parseSplitOverride({})).toEqual({ tune: [], validate: [] })
  })
})
