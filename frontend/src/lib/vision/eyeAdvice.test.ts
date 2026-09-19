import { describe, expect, it } from 'vitest'
import { EYE_MSG, eyeAdvice, eyeCauseOf, eyeWaitTimeoutMessage, sentence } from './eyeAdvice'

describe('eyeAdvice', () => {
  it('every message is a lower-case phrase without a period (spoken by the agent) and actionable', () => {
    for (const m of Object.values(EYE_MSG)) {
      expect(m).toMatch(/^[^A-Z.]*$/)
      expect(m).not.toMatch(/gaze not detected/i)
    }
  })
  it('maps a flag back to its cause and to headline + tips for the screen', () => {
    expect(eyeCauseOf(EYE_MSG.glare)).toBe('glare')
    const a = eyeAdvice(EYE_MSG.glare)!
    expect(a.headline.endsWith('.')).toBe(true)
    expect(a.headline[0]).toBe(a.headline[0].toUpperCase())
    expect(a.tips.join(' ')).toMatch(/glasses/i)
  })
  it('gives nothing for a cancel or an empty flag, and no eye tips for foreign messages', () => {
    expect(eyeAdvice('Cancelled.')).toBeNull()
    expect(eyeAdvice(undefined)).toBeNull()
    expect(eyeAdvice("I couldn't start the camera. denied")!.tips).toEqual([])
  })
  it('sentence() capitalises and ends with a period once', () => {
    expect(sentence('look at the dot')).toBe('Look at the dot.')
    expect(sentence('Done.')).toBe('Done.')
  })
  it('wait-timeout message defaults to the general advice', () => {
    expect(eyeWaitTimeoutMessage('')).toBe(EYE_MSG.lostEyes)
  })
})
