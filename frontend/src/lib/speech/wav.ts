// Pure audio helpers: WAV (RIFF, 16-bit PCM, mono) encode/decode, resampling and level statistics.
// No DOM: everything here works on Float32Array samples in [-1, 1].

/** Encode mono float samples as a 16-bit PCM WAV. Values outside [-1, 1] are clipped, NaN becomes silence. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * 2
  const buf = new ArrayBuffer(44 + dataBytes)
  const v = new DataView(buf)
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true) // fmt chunk size
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true) // byte rate
  v.setUint16(32, 2, true) // block align
  v.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  v.setUint32(40, dataBytes, true)
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]
    const c = Number.isNaN(x) ? 0 : x > 1 ? 1 : x < -1 ? -1 : x
    v.setInt16(44 + i * 2, Math.round(c < 0 ? c * 0x8000 : c * 0x7fff), true)
  }
  return buf
}

export interface DecodedWav {
  sampleRate: number
  channels: number
  bitsPerSample: number
  samples: Float32Array
}

/** Minimal decoder for the WAVs `encodeWav` writes (PCM16). Throws on anything else. Used by tests. */
export function decodeWav(buf: ArrayBuffer): DecodedWav {
  const v = new DataView(buf)
  const tag = (off: number) => String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3))
  if (buf.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file')
  let pos = 12
  let fmt: { channels: number; sampleRate: number; bits: number } | null = null
  while (pos + 8 <= buf.byteLength) {
    const id = tag(pos)
    const size = v.getUint32(pos + 4, true)
    if (id === 'fmt ') {
      if (v.getUint16(pos + 8, true) !== 1) throw new Error('not PCM')
      fmt = { channels: v.getUint16(pos + 10, true), sampleRate: v.getUint32(pos + 12, true), bits: v.getUint16(pos + 22, true) }
    } else if (id === 'data') {
      if (!fmt || fmt.bits !== 16) throw new Error('unsupported WAV format')
      const n = Math.floor(Math.min(size, buf.byteLength - pos - 8) / 2)
      const samples = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const s = v.getInt16(pos + 8 + i * 2, true)
        samples[i] = s < 0 ? s / 0x8000 : s / 0x7fff
      }
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bits, samples }
    }
    pos += 8 + size + (size % 2)
  }
  throw new Error('no data chunk')
}

/**
 * Plain linear-interpolation resampler. Fast, but it does NOT low-pass first, so downsampling folds energy above the new
 * Nyquist back into the band (aliasing). Fine for upsampling / tiny ratio changes; prefer `resample` for downsampling.
 */
export function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples.slice()
  const n = Math.floor((samples.length * toRate) / fromRate)
  const out = new Float32Array(n)
  const step = fromRate / toRate
  for (let i = 0; i < n; i++) {
    const t = i * step
    const i0 = Math.floor(t)
    const i1 = Math.min(i0 + 1, samples.length - 1)
    const f = t - i0
    out[i] = samples[i0] * (1 - f) + samples[i1] * f
  }
  return out
}

const sinc = (x: number): number => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x))
const blackman = (u: number): number => (Math.abs(u) >= 1 ? 0 : 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u))

/**
 * Anti-aliased resampler: band-limited (windowed-sinc) interpolation. For each output sample it sums the input samples
 * within `zeroCrossings` lobes of a Blackman-windowed sinc low-pass whose cutoff is 0.95 x min(input, output) Nyquist, then
 * normalizes the taps to unity DC gain (so edges and non-integer ratios keep the level). Cost O(out x taps): a 6 s clip
 * from 48 kHz is ~100 k outputs x ~100 taps, tens of ms.
 */
export function resample(samples: Float32Array, fromRate: number, toRate: number, zeroCrossings = 16): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples.slice()
  const n = Math.floor((samples.length * toRate) / fromRate)
  const out = new Float32Array(n)
  const step = fromRate / toRate
  const scale = Math.min(1, toRate / fromRate) * 0.95 // cutoff as a fraction of the input Nyquist
  const half = zeroCrossings / scale // kernel half-width in input samples
  for (let i = 0; i < n; i++) {
    const t = i * step
    const lo = Math.max(0, Math.ceil(t - half))
    const hi = Math.min(samples.length - 1, Math.floor(t + half))
    let acc = 0
    let norm = 0
    for (let j = lo; j <= hi; j++) {
      const d = j - t
      const w = sinc(d * scale) * blackman(d / half)
      acc += samples[j] * w
      norm += w
    }
    out[i] = norm !== 0 ? acc / norm : 0
  }
  return out
}

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let s = 0
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i]
  return Math.sqrt(s / samples.length)
}

export function peak(samples: Float32Array): number {
  let p = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > p) p = a
  }
  return p
}

/** Fraction of samples with |x| >= `level` (default 0.999, i.e. at full scale). */
export function clippingFraction(samples: Float32Array, level = 0.999): number {
  if (samples.length === 0) return 0
  let c = 0
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) >= level) c++
  return c / samples.length
}

export function concatFloat32(chunks: Float32Array[]): Float32Array {
  let n = 0
  for (const c of chunks) n += c.length
  const out = new Float32Array(n)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}
