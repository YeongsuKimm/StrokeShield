/// <reference types="node" />
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sha1Hex, sha256Hex } from './sha'

describe('pure sha1 / sha256', () => {
  it('matches the FIPS known answers', () => {
    expect(sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(sha1Hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('matches node:crypto for many lengths (block boundaries) and non-ASCII text', () => {
    const inputs = ['', 'a', 'sam', 'Sam O’Neil', 'é☃😀', ...Array.from({ length: 140 }, (_, i) => 'x'.repeat(i)), 'y'.repeat(1000)]
    for (const s of inputs) {
      expect(sha1Hex(s)).toBe(createHash('sha1').update(s, 'utf8').digest('hex'))
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'))
    }
  })
})
