import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureAnnouncement, countdownAnnouncement, createAnnouncer } from './announce'

describe('countdownAnnouncement', () => {
  it('speaks sparingly through a 10 second countdown', () => {
    const spoken = Array.from({ length: 10 }, (_, i) => countdownAnnouncement(10 - i, 10)).filter(Boolean)
    expect(spoken).toEqual(['Sending in 10 seconds.', 'Sending in 5 seconds.', 'Sending in 3 seconds.', 'Sending in 2 seconds.', 'Sending in 1 second.'])
  })

  it('announces the start of the short 3 second countdown and stays silent at zero', () => {
    expect(countdownAnnouncement(3, 3)).toBe('Sending in 3 seconds.')
    expect(countdownAnnouncement(0, 3)).toBeNull()
  })

  it('announces the countdown in Spanish', () => {
    expect(countdownAnnouncement(3, 3, 'es')).toBe('Se enviar\u00e1 en 3 segundos.')
    expect(countdownAnnouncement(1, 3, 'es')).toBe('Se enviar\u00e1 en 1 segundo.')
  })
})

describe('captureAnnouncement', () => {
  it('adds the seconds only on 5 second marks', () => {
    expect(captureAnnouncement('Hold both arms out', 10)).toBe('Hold both arms out. 10 seconds left.')
    expect(captureAnnouncement('Hold both arms out', 7)).toBe('Hold both arms out')
    expect(captureAnnouncement('Hold both arms out', null)).toBe('Hold both arms out')
  })

  it('speaks just the mark when there is no caption, and nothing between marks', () => {
    expect(captureAnnouncement('', 5)).toBe('5 seconds left.')
    expect(captureAnnouncement('', 4)).toBe('')
    expect(captureAnnouncement('', 0)).toBe('')
  })
})

describe('createAnnouncer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const make = () => {
    const said: string[] = []
    const a = createAnnouncer((t) => said.push(t), 3000, () => Date.now())
    return { a, said }
  }

  it('says the first message immediately', () => {
    const { a, said } = make()
    a.push('Move closer')
    expect(said).toEqual(['Move closer'])
  })

  it('collapses a burst into the first and the latest message', () => {
    const { a, said } = make()
    a.push('Move closer')
    for (const t of ['Move back', 'Move closer', 'Move left', 'Hold still']) {
      vi.advanceTimersByTime(200)
      a.push(t)
    }
    expect(said).toEqual(['Move closer'])
    vi.advanceTimersByTime(3000)
    expect(said).toEqual(['Move closer', 'Hold still'])
  })

  it('drops repeats of what was just said', () => {
    const { a, said } = make()
    a.push('Hold still')
    vi.advanceTimersByTime(5000)
    a.push('Hold still')
    vi.advanceTimersByTime(5000)
    expect(said).toEqual(['Hold still'])
  })

  it('does not re-say the old text when the message flips back before the gap ends', () => {
    const { a, said } = make()
    a.push('A')
    vi.advanceTimersByTime(100)
    a.push('B')
    vi.advanceTimersByTime(100)
    a.push('A')
    vi.advanceTimersByTime(4000)
    expect(said).toEqual(['A'])
  })

  it('cancel drops a waiting message', () => {
    const { a, said } = make()
    a.push('A')
    a.push('B')
    a.cancel()
    vi.advanceTimersByTime(5000)
    expect(said).toEqual(['A'])
  })
})
