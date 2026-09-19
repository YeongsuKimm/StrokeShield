import { describe, expect, it } from 'vitest'
import { BASE_TITLE, pageTitle } from './pageTitle'

const SEQ = ['eyes', 'face', 'arms', 'speech']

describe('pageTitle', () => {
  it('gives every screen a different title', () => {
    const titles = [
      pageTitle('home', 'idle', SEQ),
      pageTitle('info', 'idle', SEQ),
      ...SEQ.map((t) => pageTitle('home', t, SEQ)),
      pageTitle('home', 'scoring', SEQ),
      pageTitle('home', 'countdown', SEQ),
      pageTitle('home', 'alerting', SEQ),
      pageTitle('home', 'clear', SEQ),
    ]
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('keeps the honest tagline on the home page', () => {
    expect(pageTitle('home', 'idle', SEQ)).toBe(BASE_TITLE)
    expect(pageTitle('home', 'consent', SEQ)).toBe(BASE_TITLE)
  })

  it('numbers the test steps from the configured sequence', () => {
    expect(pageTitle('home', 'eyes', SEQ)).toContain('step 1 of 4')
    expect(pageTitle('home', 'speech', SEQ)).toContain('step 4 of 4')
    expect(pageTitle('home', 'face', ['face', 'arms', 'speech'])).toContain('step 1 of 3')
  })

  it('the info route wins over a phase left over from a test', () => {
    expect(pageTitle('info', 'face', SEQ)).toContain('How it works')
  })

  it('result phases that share a screen share a title', () => {
    expect(pageTitle('home', 'clear', SEQ)).toBe(pageTitle('home', 'cancelled', SEQ))
    expect(pageTitle('home', 'alerted', SEQ)).toBe(pageTitle('home', 'clear', SEQ))
  })
})
