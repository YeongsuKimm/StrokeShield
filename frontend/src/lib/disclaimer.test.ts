import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FAQS, HOTLINES, INFO_SECTIONS, PROCESS_STEPS, STATS, TIME_NOTE } from '../components/pages/infoContent'
import { DISCLAIMER_LONG, DISCLAIMER_SHORT } from './disclaimer'
import {
  BROWSER_GRANT_NOTE,
  CONSENT_CHECKBOX_LABEL,
  CONSENT_POINTS,
  SECOND_OPINION_CONSENT_TEXT,
  VOICE_CONSENT_TEXT,
} from './privacy/consentText'

const src = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

describe('disclaimer wording', () => {
  it('says the things the owner requires', () => {
    for (const d of [DISCLAIMER_LONG, DISCLAIMER_SHORT]) {
      expect(d).toMatch(/BE-FAST/)
      expect(d).toMatch(/not clinically accurate/i)
      expect(d).toMatch(/not a medical device/i)
      expect(d).toMatch(/cannot diagnose or rule out a stroke/i)
    }
    expect(DISCLAIMER_LONG).toMatch(/call 911/i)
  })
})

describe('the shared disclaimer is used on the key screens', () => {
  it.each([
    ['home page', 'components/pages/HomePage.tsx'],
    ['info page', 'components/pages/InfoPage.tsx'],
    ['result screen', 'components/result/ResultScreen.tsx'],
    ['persistent footer', 'App.tsx'],
    ['test screen shell', 'components/test/TestScreen.tsx'],
  ])('%s renders <Disclaimer />', (_name, file) => {
    expect(src(file)).toMatch(/<Disclaimer\b/)
  })

  it('the result disclaimer is in the Banner, so all three bands show it', () => {
    const s = src('components/result/ResultScreen.tsx')
    expect(s.match(/<Disclaimer\b/g)).toHaveLength(1)
    expect(s.indexOf('<Disclaimer')).toBeGreaterThan(s.indexOf('function Banner'))
    expect(s.indexOf('<Disclaimer')).toBeLessThan(s.indexOf('function ActionCard'))
  })

  it('the consent panel leads with the long disclaimer, before the checkbox', () => {
    expect(CONSENT_POINTS[0].text).toBe(DISCLAIMER_LONG)
  })

  it('the Disclaimer component reads only from the shared constants', () => {
    const s = src('components/ui/Disclaimer.tsx')
    expect(s).toMatch(/DISCLAIMER_LONG/)
    expect(s).toMatch(/DISCLAIMER_SHORT/)
  })

  it('the low-risk band cannot reassure', () => {
    const s = src('components/result/ResultScreen.tsx')
    expect(s).toMatch(/cannot rule one out/)
    expect(s).toMatch(/call 911 right away/)
  })
})

describe('no overclaiming in user-facing copy', () => {
  const copy = [
    DISCLAIMER_LONG,
    DISCLAIMER_SHORT,
    ...CONSENT_POINTS.flatMap((p) => [p.label, p.text]),
    CONSENT_CHECKBOX_LABEL,
    VOICE_CONSENT_TEXT,
    SECOND_OPINION_CONSENT_TEXT,
    BROWSER_GRANT_NOTE,
    ...INFO_SECTIONS.flatMap((s) => [s.title, s.lede ?? '']),
    ...PROCESS_STEPS.flatMap((p) => [p.instruction, p.looksFor, p.measured]),
    TIME_NOTE.body,
    ...STATS.map((s) => s.caption),
    ...FAQS.flatMap((f) => [f.q, f.a]),
    ...HOTLINES.map((h) => h.detail),
    // Screens whose copy is inline JSX rather than data.
    src('components/pages/HomePage.tsx'),
    src('components/pages/InfoPage.tsx'),
    src('components/result/ResultScreen.tsx'),
    src('components/CountdownModal.tsx'),
    src('components/test/TestScreen.tsx'),
    readFileSync(new URL('../../index.html', import.meta.url), 'utf8'),
  ].join('\n')

  const BANNED: [string, RegExp][] = [
    ['claims to diagnose/detect/screen for a stroke', /\b(?:diagnos(?:e|es|is)|detect(?:s|ion of)?|screens? for)\s+(?:a\s+|for\s+)?stroke\b/i],
    ['a claim of clinical accuracy', /(?<!not )clinically accurate/i],
    ['a claim of clinical validation', /(?<!not )(?<!not been )clinically validated/i],
    ['HIPAA compliance', /HIPAA[- ](?:compliant|safe)/i],
    ['all clear', /all[- ]clear/i],
    ['reassurance', /you(?:'re| are) (?:fine|ok|okay|safe|healthy)|I am OK|looks? okay|no stroke/i],
    ['low risk detected', /low risk detected/i],
    ['AI second opinion', /second[- ]opinion/i],
    ['guarantee', /errs toward|guarantee/i],
  ]

  it.each(BANNED)('has no %s', (_name, re) => {
    expect(copy.match(re)?.[0] ?? null).toBeNull()
  })

  it("cites a source for every statistic and says the numbers are not this app's", () => {
    for (const s of STATS) expect(s.source.length).toBeGreaterThan(5)
    expect(INFO_SECTIONS.find((s) => s.id === 'stats')?.lede).toMatch(/not results from StrokeShield/i)
  })
})
