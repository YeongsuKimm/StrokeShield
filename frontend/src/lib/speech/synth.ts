// Deterministic synthetic signals for tests (no DOM, no randomness beyond a seeded LCG).
import { concatFloat32 } from './wav'

export function tone(sampleRate: number, seconds: number, freq: number, amp: number): Float32Array {
  const n = Math.round(sampleRate * seconds)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate)
  return out
}

/** Uniform white noise in [-amp, amp] (seeded). */
export function noise(sampleRate: number, seconds: number, amp: number, seed = 1): Float32Array {
  const n = Math.round(sampleRate * seconds)
  const out = new Float32Array(n)
  let s = seed >>> 0
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    out[i] = amp * ((s / 0xffffffff) * 2 - 1)
  }
  return out
}

/** Voiced-speech stand-in: 140 Hz fundamental plus harmonics, ~`amp` peak, over a faint noise bed. */
export function voice(sampleRate: number, seconds: number, amp = 0.3, bed = 0.002): Float32Array {
  const a = tone(sampleRate, seconds, 140, amp * 0.6)
  const b = tone(sampleRate, seconds, 280, amp * 0.25)
  const c = tone(sampleRate, seconds, 420, amp * 0.15)
  const n = noise(sampleRate, seconds, bed, 7)
  return a.map((x, i) => x + b[i] + c[i] + n[i])
}

export const room = (sampleRate: number, seconds: number, amp = 0.002, seed = 3): Float32Array => noise(sampleRate, seconds, amp, seed)

export const cat = (...parts: Float32Array[]): Float32Array => concatFloat32(parts)

/** Split into chunks of `size` samples (last may be shorter). */
export function chunked(x: Float32Array, size: number): Float32Array[] {
  const out: Float32Array[] = []
  for (let i = 0; i < x.length; i += size) out.push(x.slice(i, i + size))
  return out
}
