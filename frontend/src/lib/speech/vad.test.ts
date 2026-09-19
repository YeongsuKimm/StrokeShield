import { describe, expect, it } from 'vitest'
import { cat, chunked, room, voice } from './synth'
import { createSilenceDetector, speechWindow } from './vad'

const SR = 16000

/** Feed chunks until the detector stops; returns the final state. */
function run(signal: Float32Array, chunkSize = 1024, sr = SR) {
  const vad = createSilenceDetector(sr)
  for (const c of chunked(signal, chunkSize)) {
    vad.push(c)
    if (vad.state.stop) break
  }
  return vad.state
}

describe('createSilenceDetector', () => {
  it('detects speech and stops after 1.2 s of trailing silence', () => {
    const st = run(cat(room(SR, 0.5), voice(SR, 2), room(SR, 3)))
    expect(st.speechDetected).toBe(true)
    expect(st.stop).toBe('silence')
    expect(st.speechStartS).toBeGreaterThan(0.4)
    expect(st.speechStartS).toBeLessThan(0.65)
    expect(st.lastVoicedEndS).toBeGreaterThan(2.4)
    expect(st.lastVoicedEndS).toBeLessThan(2.6)
    expect(st.trailingSilenceS).toBeGreaterThanOrEqual(1.2 - 1e-6)
    expect(st.elapsedS).toBeCloseTo(2.5 + 1.2, 1)
  })

  it('does not stop on a pause shorter than 1.2 s', () => {
    const st = run(cat(room(SR, 0.3), voice(SR, 1), room(SR, 1.0), voice(SR, 1), room(SR, 3)))
    expect(st.stop).toBe('silence')
    expect(st.lastVoicedEndS).toBeGreaterThan(3.2) // the second word was captured
  })

  it('does not cut off a hesitant start: a short first burst, a 1.6 s think, then the rest of the sentence', () => {
    const st = run(cat(room(SR, 0.3), voice(SR, 0.6), room(SR, 1.6), voice(SR, 1.8), room(SR, 3)))
    expect(st.stop).toBe('silence')
    expect(st.lastVoicedEndS).toBeGreaterThan(4.0) // the rest of the sentence was captured
  })

  it('a lone cough followed by silence waits 2 s (not 1.2 s) before giving up', () => {
    const st = run(cat(room(SR, 0.3), voice(SR, 0.3), room(SR, 4)))
    expect(st.stop).toBe('silence')
    expect(st.trailingSilenceS).toBeGreaterThanOrEqual(2 - 1e-6)
  })

  it('a full-length utterance still stops after the normal 1.2 s of silence', () => {
    const st = run(cat(room(SR, 0.3), voice(SR, 2.5), room(SR, 3)))
    expect(st.trailingSilenceS).toBeLessThan(1.3)
  })

  it('never stops before 1.5 s of audio even with a short utterance', () => {
    const vad = createSilenceDetector(SR)
    const sig = cat(room(SR, 0.1), voice(SR, 0.3), room(SR, 3))
    let stoppedAt = -1
    for (const c of chunked(sig, 320)) {
      vad.push(c)
      if (vad.state.stop) {
        stoppedAt = vad.state.elapsedS
        break
      }
    }
    // trailing silence hits 1.2 s at ~1.6 s here, but the clip must also be >= 1.5 s: never earlier than that.
    expect(stoppedAt).toBeGreaterThanOrEqual(1.5 - 1e-6)
    expect(vad.state.stop).toBe('silence')
  })

  it('hard-stops at 6 s while the person keeps talking', () => {
    const st = run(cat(room(SR, 0.2), voice(SR, 10)))
    expect(st.stop).toBe('max-duration')
    expect(st.elapsedS).toBeCloseTo(6, 2)
  })

  it('reports no-speech after 4 s of room noise', () => {
    const st = run(room(SR, 10))
    expect(st.speechDetected).toBe(false)
    expect(st.stop).toBe('no-speech')
    expect(st.elapsedS).toBeCloseTo(4, 2)
  })

  it('reports no-speech for digital silence', () => {
    const st = run(new Float32Array(SR * 6))
    expect(st.stop).toBe('no-speech')
    expect(st.speechDetected).toBe(false)
  })

  it('adapts to a noisy room: steady loud noise is not speech, speech on top of it is', () => {
    const hum = room(SR, 5, 0.03, 11)
    expect(run(hum).speechDetected).toBe(false)
    const st = run(cat(room(SR, 0.5, 0.03, 11), voice(SR, 2, 0.5, 0.03), room(SR, 3, 0.03, 12)))
    expect(st.speechDetected).toBe(true)
    expect(st.stop).toBe('silence')
  })

  it('detects speech that starts right at t=0 (no lead-in silence to learn the floor from)', () => {
    const st = run(cat(voice(SR, 10)))
    expect(st.speechDetected).toBe(true)
    expect(st.stop).toBe('max-duration')
  })

  it('detects quiet (tired) speech', () => {
    const st = run(cat(room(SR, 0.4), voice(SR, 2, 0.06), room(SR, 3)))
    expect(st.speechDetected).toBe(true)
    expect(st.stop).toBe('silence')
  })

  it('ignores a single click', () => {
    const click = new Float32Array(SR * 4)
    click[SR] = 0.9
    click[SR + 1] = -0.9
    expect(run(click).speechDetected).toBe(false)
  })

  it('is not fooled by a DC offset', () => {
    const dc = room(SR, 5, 0.001).map((x) => x + 0.2)
    expect(run(dc).speechDetected).toBe(false)
  })

  it('gives the same result for any chunk size, including sizes that split frames', () => {
    const sig = cat(room(SR, 0.5), voice(SR, 1.5), room(SR, 3))
    const a = run(sig, 128)
    const b = run(sig, 4096)
    const c = run(sig, 333)
    expect(b.stop).toBe(a.stop)
    expect(c.stop).toBe(a.stop)
    expect(b.elapsedS).toBeCloseTo(a.elapsedS, 1)
    expect(c.elapsedS).toBeCloseTo(a.elapsedS, 1)
  })

  it('reports a level for the meter and keeps stop sticky', () => {
    const vad = createSilenceDetector(SR)
    vad.push(voice(SR, 0.1, 0.4))
    expect(vad.state.level).toBeGreaterThan(0.1)
    const st = run(room(SR, 10))
    expect(st.stop).toBe('no-speech')
    const v2 = createSilenceDetector(SR)
    for (const c of chunked(room(SR, 5), 1024)) v2.push(c)
    expect(v2.state.stop).toBe('no-speech')
    expect(v2.state.elapsedS).toBeCloseTo(4, 2) // did not keep counting after stop
  })

  it('works at 48 kHz too', () => {
    const st = run(cat(room(48000, 0.5), voice(48000, 2), room(48000, 3)), 2048, 48000)
    expect(st.stop).toBe('silence')
    expect(st.speechDetected).toBe(true)
  })

  it('honors custom limits', () => {
    const vad = createSilenceDetector(SR, { maxSeconds: 2 })
    for (const c of chunked(voice(SR, 5), 1024)) {
      vad.push(c)
      if (vad.state.stop) break
    }
    expect(vad.state.stop).toBe('max-duration')
    expect(vad.state.elapsedS).toBeCloseTo(2, 2)
  })
})

describe('speechWindow', () => {
  it('pads the utterance and clamps to the clip', () => {
    expect(speechWindow({ speechStartS: 1, lastVoicedEndS: 3 }, SR, 5 * SR)).toEqual([Math.floor(0.7 * SR), Math.ceil(3.5 * SR)])
    expect(speechWindow({ speechStartS: 0.1, lastVoicedEndS: 4.9 }, SR, 5 * SR)).toEqual([0, 5 * SR])
  })
  it('widens short utterances to at least 1.5 s', () => {
    const [a, b] = speechWindow({ speechStartS: 1, lastVoicedEndS: 1.4 }, SR, 5 * SR)
    expect((b - a) / SR).toBeGreaterThanOrEqual(1.5 - 1e-6)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(b).toBeLessThanOrEqual(5 * SR)
  })
  it('returns the whole clip when no speech was found', () => {
    expect(speechWindow({ speechStartS: null, lastVoicedEndS: null }, SR, 1234)).toEqual([0, 1234])
  })
})
