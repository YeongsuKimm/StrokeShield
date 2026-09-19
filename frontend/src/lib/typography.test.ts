import { describe, expect, it } from 'vitest'
import { smartQuotes } from './typography'

describe('smartQuotes', () => {
  it('curls apostrophes inside words', () => {
    expect(smartQuotes("I couldn't see you. Let's try again.")).toBe('I couldn’t see you. Let’s try again.')
  })
  it('curls double quotes in pairs', () => {
    expect(smartQuotes('Say "hello" now')).toBe('Say “hello” now')
  })
  it('opens and closes single quotes', () => {
    expect(smartQuotes("she said 'stop' twice")).toBe('she said ‘stop’ twice')
  })
  it('leaves text without quotes, and already-curly text, untouched', () => {
    expect(smartQuotes('Nothing to change here.')).toBe('Nothing to change here.')
    expect(smartQuotes('Already ’fine’')).toBe('Already ’fine’')
  })
  it('does not mutate the source constant used for matching', () => {
    const phrase = "You can't teach an old dog new tricks."
    void smartQuotes(phrase)
    expect(phrase).toContain("'")
  })
})
