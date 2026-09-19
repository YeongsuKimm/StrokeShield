import { describe, expect, it } from 'vitest'
import { classifyMicError, MIC_ERROR_TEXT, MicError } from './micErrors'

const err = (name: string) => Object.assign(new Error(name), { name })

describe('classifyMicError', () => {
  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['SecurityError', 'permission-denied'],
    ['PermissionDeniedError', 'permission-denied'],
    ['NotFoundError', 'no-microphone'],
    ['DevicesNotFoundError', 'no-microphone'],
    ['OverconstrainedError', 'no-microphone'],
    ['NotReadableError', 'mic-busy'],
    ['TrackStartError', 'mic-busy'],
    ['AbortError', 'mic-busy'],
    ['TypeError', 'unsupported'],
    ['SomethingElse', 'unknown'],
  ] as const)('%s -> %s', (name, kind) => {
    expect(classifyMicError(err(name))).toBe(kind)
  })

  it('handles null / non-error values', () => {
    expect(classifyMicError(null)).toBe('unknown')
    expect(classifyMicError(undefined)).toBe('unknown')
    expect(classifyMicError('boom')).toBe('unknown')
  })

  it('every kind has actionable text; unsupported names the fix; muted says where to look', () => {
    for (const text of Object.values(MIC_ERROR_TEXT)) expect(text.length).toBeGreaterThan(20)
    expect(MIC_ERROR_TEXT.unsupported).toMatch(/HTTPS/)
    expect(MIC_ERROR_TEXT.unsupported).toMatch(/Chrome/)
    expect(MIC_ERROR_TEXT.muted).toMatch(/mute/i)
    expect(new MicError('muted').kind).toBe('muted')
  })

  it('MicError carries its kind and default text', () => {
    const e = new MicError('permission-denied')
    expect(e.kind).toBe('permission-denied')
    expect(e.message).toBe(MIC_ERROR_TEXT['permission-denied'])
    expect(e).toBeInstanceOf(Error)
  })
})
