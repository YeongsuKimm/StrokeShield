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

  it('MicError carries its kind and default text', () => {
    const e = new MicError('permission-denied')
    expect(e.kind).toBe('permission-denied')
    expect(e.message).toBe(MIC_ERROR_TEXT['permission-denied'])
    expect(e).toBeInstanceOf(Error)
  })
})
