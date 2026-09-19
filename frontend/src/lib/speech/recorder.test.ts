import { afterEach, describe, expect, it, vi } from 'vitest'
import { assessLevel, assessQc } from './qc'
import { MicError, RecordingCancelled, recordSpeech, type MicCapture, type RecorderDeps } from './recorder'
import { cat, chunked, room, tone, voice } from './synth'
import { decodeWav } from './wav'

class FakeMic implements MicCapture {
  closed = 0
  private onChunk: ((c: Float32Array) => void) | undefined
  private onError: ((e: unknown) => void) | undefined
  readonly sampleRate: number
  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
  }
  start(onChunk: (c: Float32Array) => void, onError: (e: unknown) => void) {
    this.onChunk = onChunk
    this.onError = onError
  }
  close() {
    this.closed++
  }
  feed(signal: Float32Array, size = 1024) {
    for (const c of chunked(signal, size)) this.onChunk?.(c)
  }
  fail(e: unknown) {
    this.onError?.(e)
  }
}

const depsFor = (mic: FakeMic, stallTimeoutMs = 60_000): RecorderDeps => ({ openCapture: () => Promise.resolve(mic), stallTimeoutMs })
const started = () => Promise.resolve() // let recordSpeech reach cap.start

afterEach(() => vi.useRealTimers())

describe('recordSpeech', () => {
  it('records until trailing silence, returns a valid 16 kHz WAV with QC and trims the silence', async () => {
    const mic = new FakeMic(16000)
    const levels: number[] = []
    const p = recordSpeech({ onLevel: (l) => levels.push(l) }, depsFor(mic))
    await started()
    mic.feed(cat(room(16000, 1.5), voice(16000, 2, 0.3), room(16000, 3)))
    const rec = await p
    expect(rec.sampleRate).toBe(16000)
    expect(rec.stopReason).toBe('silence')
    expect(rec.qc.speechDetected).toBe(true)
    expect(rec.qc.level).toBe('ok')
    expect(rec.qc.peak).toBeGreaterThan(0.2)
    expect(rec.qc.clipping).toBe(0)
    expect(rec.durationS).toBeGreaterThan(2.5) // 2 s speech + pads
    expect(rec.durationS).toBeLessThan(3.2) // leading 1.5 s of room noise trimmed
    expect(rec.wav.type).toBe('audio/wav')
    const d = decodeWav(await rec.wav.arrayBuffer())
    expect(d.sampleRate).toBe(16000)
    expect(d.samples.length / 16000).toBeCloseTo(rec.durationS, 3)
    expect(levels.length).toBeGreaterThan(0)
    expect(mic.closed).toBe(1)
  })

  it('stops at the 6 s cap when the person keeps talking', async () => {
    const mic = new FakeMic(16000)
    const p = recordSpeech({}, depsFor(mic))
    await started()
    mic.feed(voice(16000, 10))
    const rec = await p
    expect(rec.stopReason).toBe('max-duration')
    expect(rec.durationS).toBeLessThanOrEqual(6.01)
    expect(mic.closed).toBe(1)
  })

  it('honors a smaller maxSeconds', async () => {
    const mic = new FakeMic(16000)
    const p = recordSpeech({ maxSeconds: 2 }, depsFor(mic))
    await started()
    mic.feed(voice(16000, 10))
    const rec = await p
    expect(rec.durationS).toBeLessThanOrEqual(2.01)
  })

  it('returns speechDetected=false after ~4 s of silence', async () => {
    const mic = new FakeMic(16000)
    const p = recordSpeech({}, depsFor(mic))
    await started()
    mic.feed(room(16000, 10))
    const rec = await p
    expect(rec.stopReason).toBe('no-speech')
    expect(rec.qc.speechDetected).toBe(false)
    expect(rec.qc.level).toBe('too-quiet')
  })

  it('resamples a 48 kHz capture to 16 kHz', async () => {
    const mic = new FakeMic(48000)
    const p = recordSpeech({}, depsFor(mic))
    await started()
    mic.feed(cat(room(48000, 0.5), voice(48000, 2, 0.3), room(48000, 3)), 2048)
    const rec = await p
    expect(rec.sampleRate).toBe(16000)
    const d = decodeWav(await rec.wav.arrayBuffer())
    expect(d.sampleRate).toBe(16000)
    expect(rec.durationS).toBeGreaterThan(2.5)
    expect(rec.durationS).toBeLessThan(3.5)
    expect(rec.qc.speechDetected).toBe(true)
  })

  it('flags a too-loud recording', async () => {
    const mic = new FakeMic(16000)
    const p = recordSpeech({}, depsFor(mic))
    await started()
    const loud = voice(16000, 2, 3).map((x) => Math.max(-1, Math.min(1, x))) // hard clipped
    mic.feed(cat(room(16000, 0.3), loud, room(16000, 3)))
    const rec = await p
    expect(rec.qc.level).toBe('too-loud')
    expect(rec.qc.clipping).toBeGreaterThan(0.01)
  })

  it('flags a too-quiet recording', async () => {
    const mic = new FakeMic(16000)
    const p = recordSpeech({}, depsFor(mic))
    await started()
    mic.feed(cat(room(16000, 0.3, 0.0005), tone(16000, 2, 200, 0.012), room(16000, 3, 0.0005)))
    const rec = await p
    expect(rec.qc.level).toBe('too-quiet')
  })

  it('rejects with RecordingCancelled and releases the mic on abort', async () => {
    const mic = new FakeMic(16000)
    const ctrl = new AbortController()
    const p = recordSpeech({ signal: ctrl.signal }, depsFor(mic))
    await started()
    mic.feed(voice(16000, 0.5))
    ctrl.abort()
    await expect(p).rejects.toBeInstanceOf(RecordingCancelled)
    expect(mic.closed).toBe(1)
  })

  it('does not open the mic when already aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const open = vi.fn()
    await expect(recordSpeech({ signal: ctrl.signal }, { openCapture: open, stallTimeoutMs: 1000 })).rejects.toBeInstanceOf(RecordingCancelled)
    expect(open).not.toHaveBeenCalled()
  })

  it('propagates a typed MicError from opening the mic', async () => {
    const deps: RecorderDeps = { openCapture: () => Promise.reject(new MicError('permission-denied')), stallTimeoutMs: 1000 }
    await expect(recordSpeech({}, deps)).rejects.toMatchObject({ kind: 'permission-denied' })
  })

  it('wraps a capture error mid-recording and still closes the mic', async () => {
    const mic = new FakeMic(16000)
    const p = recordSpeech({}, depsFor(mic))
    await started()
    mic.fail(new Error('worklet died'))
    await expect(p).rejects.toBeInstanceOf(MicError)
    expect(mic.closed).toBe(1)
  })

  it('rejects when the mic stops delivering audio', async () => {
    vi.useFakeTimers()
    const mic = new FakeMic(16000)
    const p = recordSpeech({}, depsFor(mic, 3000))
    const assertion = expect(p).rejects.toBeInstanceOf(MicError)
    await vi.advanceTimersByTimeAsync(3100)
    await assertion
    expect(mic.closed).toBe(1)
  })

  it('closes the mic when start throws', async () => {
    const mic = new FakeMic(16000)
    mic.start = () => {
      throw new MicError('unknown')
    }
    await expect(recordSpeech({}, depsFor(mic))).rejects.toBeInstanceOf(MicError)
    expect(mic.closed).toBe(1)
  })
})

describe('qc', () => {
  it('assessLevel thresholds', () => {
    expect(assessLevel(0.3, 0)).toBe('ok')
    expect(assessLevel(0.01, 0)).toBe('too-quiet')
    expect(assessLevel(1, 0.02)).toBe('too-loud')
    expect(assessLevel(0.005, 0.5)).toBe('too-loud') // clipping wins
  })
  it('assessQc computes peak and clipping from samples', () => {
    const x = new Float32Array(200).fill(0.1)
    x[0] = 1
    x[1] = -1
    const q = assessQc(x, true)
    expect(q.peak).toBe(1)
    expect(q.clipping).toBeCloseTo(0.01)
    expect(q.level).toBe('too-loud')
    expect(q.speechDetected).toBe(true)
  })
})
