import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MEASURED_COPY, PREVIEW_COPY, RESULT_BAND_COPY, SUMMARY_COPY, homeStepsHint } from './features'

const words = (s: string) => s.trim().split(/\s+/).length
const source = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

describe('home-page hint', () => {
  it('is present, short and one sentence', () => {
    for (const count of ['three', 'four', 'five']) {
      const hint = homeStepsHint(count)
      expect(hint).toContain('camera')
      expect(hint).toContain(count)
      expect(words(hint)).toBeLessThanOrEqual(14)
      expect(hint.length).toBeLessThanOrEqual(80) // about one short line, two at 320 px
      expect(hint.match(/[.!?]/g)?.length).toBe(1)
    }
  })

  it('is rendered as one quiet paragraph under the start button: no card, no icon, no new section', () => {
    const page = source('../../components/pages/HomePage.tsx')
    const line = page.split('\n').find((l) => l.includes('homeStepsHint(')) ?? ''
    expect(line).toMatch(/^\s*<p className="[^"]*text-ink-3[^"]*">/)
    expect(line).not.toMatch(/Icon|border|rounded|bg-|<section/)
    // and it comes after the button row, before the consent hint
    expect(page.indexOf('homeStepsHint(')).toBeGreaterThan(page.indexOf('Start the check'))
    expect(page.indexOf('homeStepsHint(')).toBeLessThan(page.indexOf('id="start-hint"'))
  })
})

describe('feature copy', () => {
  it('uses the strings the owner asked for', () => {
    expect(PREVIEW_COPY.before).toBe('This is the text that will be sent')
    expect(PREVIEW_COPY.live).toBe('Delivery is best effort.')
    expect(PREVIEW_COPY.demoBefore).toBe('Demo mode: nothing will be sent.')
    expect(SUMMARY_COPY.button).toBe('Copy summary')
    expect(SUMMARY_COPY.copied).toBe('Summary copied')
    expect(SUMMARY_COPY.call911).toBe('Call 911 if you think this is a stroke.')
  })

  it('never says all clear, fine or safe, and every mention of diagnosis is a denial', () => {
    const all = JSON.stringify([RESULT_BAND_COPY, PREVIEW_COPY, SUMMARY_COPY, MEASURED_COPY, homeStepsHint('four')]).toLowerCase()
    for (const banned of ['all clear', 'you are fine', 'you are safe', 'healthy', 'exclamation!']) expect(all).not.toContain(banned)
    for (const m of all.matchAll(/diagnos\w*/g)) {
      expect(all.slice(Math.max(0, m.index - 12), m.index)).toMatch(/(not a |cannot |not )$/)
    }
  })

  it('keeps the measured panel to measurements: each check is labelled measured, not a diagnosis', () => {
    expect(MEASURED_COPY.note).toBe('Measured, not a diagnosis.')
    expect(MEASURED_COPY.notMeasured).toBe('Not measured.')
  })

  it('the result banner and the copied summary share one source of wording', () => {
    const screen = source('../../components/result/ResultScreen.tsx')
    expect(screen).toContain('RESULT_BAND_COPY[band]')
    expect(screen).not.toContain('These checks did not flag anything')
  })

  it('the preview never delays the countdown: the timer effect does not depend on it', () => {
    const modal = source('../../components/CountdownModal.tsx')
    expect(modal).toContain('<AlertPreview stage="before"')
    expect(modal.indexOf('<AlertPreview')).toBeGreaterThan(modal.indexOf('countdown-cancel'))
    expect(modal).toContain('}, [left, confirmCountdown])') // the timer effect's inputs: nothing from the preview
  })
})
