import { describe, expect, it } from 'vitest'
import { evaluateMic, SILENCE_GRACE_MS } from './micLevel'

const input = (over: Partial<Parameters<typeof evaluateMic>[0]> = {}) =>
  evaluateMic({ hasStream: true, trackEnabled: true, trackMuted: false, msSinceSound: 0, ...over })

describe('evaluateMic', () => {
  it('reports no mic when there is no stream', () => {
    expect(input({ hasStream: false })).toEqual({ muted: true, reason: 'no-mic' })
  })

  it('a track that ENDED (permission revoked mid-session, device unplugged) is flagged at once, not after the silence grace', () => {
    expect(input({ trackEnded: true, msSinceSound: 0 })).toEqual({ muted: true, reason: 'track-off' })
  })

  it('reports a disabled or hardware-muted track', () => {
    expect(input({ trackEnabled: false }).reason).toBe('track-off')
    expect(input({ trackMuted: true }).reason).toBe('track-off')
  })

  it('tolerates pauses between words', () => {
    expect(input({ msSinceSound: SILENCE_GRACE_MS - 1 }).muted).toBe(false)
  })

  it('warns once the silence outlasts the grace period', () => {
    expect(input({ msSinceSound: SILENCE_GRACE_MS })).toEqual({ muted: true, reason: 'no-sound' })
  })

  it('is happy with a live track that is making sound', () => {
    expect(input()).toEqual({ muted: false, reason: 'ok' })
  })
})
