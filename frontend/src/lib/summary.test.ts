import { describe, expect, it } from 'vitest'
import type { ResultBand } from './config'
import type { TestName, TestResult } from './contracts'
import { RESULT_BAND_COPY } from './copy/features'
import { copyToClipboard } from './copyToClipboard'
import { DISCLAIMER_SHORT } from './disclaimer'
import { buildSummary, plainFlag } from './summary'

const result = (test: TestName, flags: string[], extra: Partial<TestResult> = {}): TestResult => ({
  test,
  severity: 0.777,
  confidence: 0.913,
  metrics: { lift_left: 0.0812345, lift_right: 0.0212345 },
  flags,
  startedAt: 0,
  durationMs: 1000,
  ...extra,
})
const ORDER: TestName[] = ['eyes', 'face', 'arms', 'speech']
const NOW = new Date('2026-09-19T21:20:00Z')
const base = (band: ResultBand = 'caution') => ({
  now: NOW,
  timeZone: 'UTC',
  band,
  order: ORDER,
  results: {
    eyes: result('eyes', []),
    face: result('face', ['smile uneven']),
    arms: result('arms', ['left arm drifted down', 'transcript mismatch (CER 0.42)']),
  },
  skipped: ['speech'] as TestName[],
})

describe('buildSummary', () => {
  it('lists date, completed and skipped checks, plain flags, the band wording, disclaimer and 911 line', () => {
    const text = buildSummary({ ...base(), lastKnownWell: '8:30 pm' })
    expect(text).toContain('Date: Sep 19, 2026, 9:20 PM')
    expect(text).toContain('Checks completed: Eyes, Face, Arms')
    expect(text).toContain('Checks skipped or not measured: Speech')
    expect(text).toContain('Eyes: nothing flagged')
    expect(text).toContain('Face: smile uneven')
    expect(text).toContain('Arms: left arm drifted down; transcript mismatch')
    expect(text).toContain(`Result: ${RESULT_BAND_COPY.caution.label}. ${RESULT_BAND_COPY.caution.body}`)
    expect(text).toContain('Last known well: 8:30 pm')
    expect(text).toContain(DISCLAIMER_SHORT)
    expect(text.trimEnd().endsWith('Call 911 if you think this is a stroke.')).toBe(true)
  })

  it('uses the same wording as the screen for every band', () => {
    for (const band of ['low', 'caution', 'high'] as const) {
      const text = buildSummary(base(band))
      expect(text).toContain(RESULT_BAND_COPY[band].label)
      expect(text).toContain(RESULT_BAND_COPY[band].body)
    }
  })

  it('leaves out raw numbers, scores, location and names', () => {
    const text = buildSummary({ ...base(), lastKnownWell: 'noon' })
    for (const leaked of ['0.0812', '0.777', '0.913', '0.42', 'CER', 'lat', 'maps.google', 'severity', 'confidence', 'risk', '%']) {
      expect(text).not.toContain(leaked)
    }
  })

  it('omits the last-known-well line when none was given, and flattens one that has line breaks', () => {
    expect(buildSummary(base())).not.toContain('Last known well')
    const text = buildSummary({ ...base(), lastKnownWell: `8:30\r\nCall me\tlater ${'x'.repeat(300)}` })
    const line = text.split('\n').find((l) => l.startsWith('Last known well')) ?? ''
    expect(line.startsWith('Last known well: 8:30 Call me later')).toBe(true)
    expect(line.length).toBeLessThanOrEqual('Last known well: '.length + 200)
  })

  it('treats a check that needs a retry as not measured, and lists no flags for it', () => {
    const text = buildSummary({ ...base(), results: { ...base().results, face: result('face', ['low confidence: retry'], { needsRetry: true }) } })
    expect(text).toContain('Checks completed: Eyes, Arms')
    expect(text).toContain('Checks skipped or not measured: Face, Speech')
    expect(text).not.toContain('low confidence')
  })

  it('handles nothing completed', () => {
    const text = buildSummary({ ...base('low'), results: {}, skipped: [...ORDER] })
    expect(text).toContain('Checks completed: none')
    expect(text).toContain('Checks skipped or not measured: Eyes, Face, Arms, Speech')
  })

  it('never says all clear, you are fine, or claims a diagnosis', () => {
    for (const band of ['low', 'caution', 'high'] as const) {
      const text = buildSummary(base(band)).toLowerCase()
      for (const banned of ['all clear', 'you are fine', "you're fine", 'you are safe', 'no stroke', 'healthy', 'you have had a stroke', 'you are having a stroke']) {
        expect(text).not.toContain(banned)
      }
      // Every mention of diagnosis is a denial ("not a diagnosis", "cannot diagnose").
      for (const m of text.matchAll(/diagnos\w*/g)) {
        expect(text.slice(Math.max(0, m.index - 12), m.index)).toMatch(/(not a |cannot |not )$/)
      }
    }
  })

  it('is plain text: no markup and no control characters other than newlines', () => {
    const text = buildSummary(base())
    expect(text).not.toMatch(/[<>]/)
    // oxlint-disable-next-line no-control-regex
    expect(text).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f]/)
  })
})

describe('plainFlag', () => {
  it('drops bracketed numbers and control characters', () => {
    expect(plainFlag('transcript mismatch (CER 0.42)')).toBe('transcript mismatch')
    expect(plainFlag('left arm\ndrifted   down')).toBe('left arm drifted down')
    expect(plainFlag('smile uneven')).toBe('smile uneven')
  })
})

describe('copyToClipboard', () => {
  it('uses the clipboard API when it works', async () => {
    let copied = ''
    expect(await copyToClipboard('hi', { writeText: async (t) => void (copied = t), execCopy: () => false })).toBe('copied')
    expect(copied).toBe('hi')
  })

  it('falls back to the textarea route when the clipboard API is missing or refuses', async () => {
    expect(await copyToClipboard('hi', { execCopy: () => true })).toBe('copied')
    expect(await copyToClipboard('hi', { writeText: () => Promise.reject(new Error('denied')), execCopy: () => true })).toBe('copied')
  })

  it('reports failure (so the page shows a selectable text area) when both routes fail or throw', async () => {
    expect(await copyToClipboard('hi', { writeText: () => Promise.reject(new Error('denied')), execCopy: () => false })).toBe('failed')
    expect(await copyToClipboard('hi', { execCopy: () => { throw new Error('nope') } })).toBe('failed')
    expect(await copyToClipboard('hi', {})).toBe('failed')
  })
})
