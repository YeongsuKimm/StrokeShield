import { describe, expect, it } from 'vitest'
import { tone } from './synth'
import { clippingFraction, decodeWav, encodeWav, peak, resample, resampleLinear, rms } from './wav'

describe('encodeWav', () => {
  it('writes a correct 16-bit mono PCM RIFF header', () => {
    const x = tone(16000, 0.5, 440, 0.5)
    const buf = encodeWav(x, 16000)
    const v = new DataView(buf)
    const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))
    expect(buf.byteLength).toBe(44 + x.length * 2)
    expect(tag(0)).toBe('RIFF')
    expect(v.getUint32(4, true)).toBe(buf.byteLength - 8)
    expect(tag(8)).toBe('WAVE')
    expect(tag(12)).toBe('fmt ')
    expect(v.getUint32(16, true)).toBe(16)
    expect(v.getUint16(20, true)).toBe(1) // PCM
    expect(v.getUint16(22, true)).toBe(1) // mono
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getUint32(28, true)).toBe(32000)
    expect(v.getUint16(32, true)).toBe(2)
    expect(v.getUint16(34, true)).toBe(16)
    expect(tag(36)).toBe('data')
    expect(v.getUint32(40, true)).toBe(x.length * 2)
  })

  it('round-trips within 16-bit quantization error', () => {
    const x = tone(16000, 0.25, 300, 0.8)
    const d = decodeWav(encodeWav(x, 16000))
    expect(d.sampleRate).toBe(16000)
    expect(d.channels).toBe(1)
    expect(d.bitsPerSample).toBe(16)
    expect(d.samples.length).toBe(x.length)
    let maxErr = 0
    for (let i = 0; i < x.length; i++) maxErr = Math.max(maxErr, Math.abs(d.samples[i] - x[i]))
    expect(maxErr).toBeLessThan(1 / 32000)
  })

  it('clips out-of-range values and maps NaN to silence without wrapping', () => {
    const d = decodeWav(encodeWav(Float32Array.from([2, -2, 1, -1, NaN, 0]), 8000))
    expect(Array.from(d.samples)).toEqual([1, -1, 1, -1, 0, 0])
  })

  it('handles an empty clip', () => {
    const d = decodeWav(encodeWav(new Float32Array(0), 16000))
    expect(d.samples.length).toBe(0)
  })

  it('rejects non-WAV input', () => {
    expect(() => decodeWav(new ArrayBuffer(64))).toThrow()
  })
})

describe('level statistics', () => {
  it('rms / peak of a sine', () => {
    const x = tone(16000, 1, 200, 0.5)
    expect(rms(x)).toBeCloseTo(0.5 / Math.SQRT2, 3)
    expect(peak(x)).toBeCloseTo(0.5, 3)
  })
  it('clippingFraction counts full-scale samples', () => {
    const x = new Float32Array(100)
    for (let i = 0; i < 5; i++) x[i] = i % 2 ? -1 : 1
    expect(clippingFraction(x)).toBeCloseTo(0.05)
    expect(clippingFraction(new Float32Array(0))).toBe(0)
  })
})

describe('resampling', () => {
  it('keeps a 1 kHz tone (48k -> 16k) at the right amplitude and length', () => {
    const y = resample(tone(48000, 1, 1000, 0.5), 48000, 16000)
    expect(y.length).toBe(16000)
    expect(rms(y.subarray(400, y.length - 400))).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })
  it('handles non-integer ratios (44.1k -> 16k)', () => {
    const y = resample(tone(44100, 1, 500, 0.4), 44100, 16000)
    expect(y.length).toBe(16000)
    expect(rms(y.subarray(400, y.length - 400))).toBeCloseTo(0.4 / Math.SQRT2, 2)
  })
  it('suppresses content above the new Nyquist, unlike linear interpolation which aliases it', () => {
    const hi = tone(48000, 1, 10000, 0.5) // 10 kHz > 8 kHz Nyquist of 16 kHz
    const good = resample(hi, 48000, 16000)
    const bad = resampleLinear(hi, 48000, 16000)
    expect(rms(good.subarray(400, good.length - 400))).toBeLessThan(0.02)
    expect(rms(bad.subarray(400, bad.length - 400))).toBeGreaterThan(0.1)
  })
  it('is the identity when rates match and copes with empty input', () => {
    const x = tone(16000, 0.1, 300, 0.5)
    expect(Array.from(resample(x, 16000, 16000))).toEqual(Array.from(x))
    expect(resample(new Float32Array(0), 48000, 16000).length).toBe(0)
    expect(resampleLinear(new Float32Array(0), 48000, 16000).length).toBe(0)
  })
  it('linear resampler preserves a slow tone', () => {
    const y = resampleLinear(tone(32000, 1, 200, 0.5), 32000, 16000)
    expect(y.length).toBe(16000)
    expect(rms(y)).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })
})
