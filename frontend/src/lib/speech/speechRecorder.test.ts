import { describe, expect, it } from 'vitest'
import type { TestResult } from '../contracts'
import { sanitizeConditions, sanitizeEnv } from '../calibration/recording'
import { recordSpeech, type MicCapture, type RecorderDeps } from './recorder'
import { buildSpeechSidecar } from './speechRecorder'
import { cat, chunked, room, voice } from './synth'

const liveResult: TestResult = { test: 'speech', severity: 0.1, confidence: 0.9, metrics: {}, flags: [], startedAt: 1, durationMs: 2 }
const base = {
  subject: ' Sam ',
  scenarioId: 'speech-normal',
  notes: '',
  targetPhrase: 'x',
  durationS: 2,
  sampleRate: 16000,
  createdAt: '2026-09-19T01:02:03.456Z',
  liveResult,
}

describe('buildSpeechSidecar', () => {
  it('keeps the base sidecar and adds conditions + env from the recorder settings', () => {
    const sc = buildSpeechSidecar({
      ...base,
      conditions: { mic: 'headset', noise: 'quiet', nativeEnglish: true, device: 'thinkpad x1', glasses: true },
      track: { sampleRate: 48000, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      envSources: { userAgent: 'UA/1', hardwareConcurrency: 8, deviceMemory: 16, screen: { width: 1920, height: 1080 } },
    })
    expect(sc).toMatchObject({ schema: 1, kind: 'speech', subject: 'Sam', scenario: 'speech-normal', expected: 'healthy' })
    expect(sc.conditions).toEqual({ mic: 'headset', noise: 'quiet', nativeEnglish: true, device: 'thinkpad x1' }) // vision-only keys dropped
    expect(sc.env).toEqual({
      userAgent: 'UA/1',
      hardwareConcurrency: 8,
      deviceMemoryGB: 16,
      screen: '1920x1080',
      sampleRate: 48000,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    })
  })

  it('missing values are null, never undefined or a crash', () => {
    const sc = buildSpeechSidecar({ ...base, envSources: {} })
    expect(sc.conditions).toEqual({ mic: null, noise: null, nativeEnglish: null, device: null })
    expect(sc.env).toEqual({ deviceMemoryGB: null, sampleRate: null, echoCancellation: null, noiseSuppression: null, autoGainControl: null })
    expect(JSON.parse(JSON.stringify(sc)).conditions).toEqual(sc.conditions) // survives JSON, nulls included
    expect(Object.values(sc.conditions).every((v) => v === null)).toBe(true)
  })

  it('round-trips through the tolerant readers used by the validators', () => {
    const sc = buildSpeechSidecar({ ...base, conditions: { mic: 'external', noise: 'loud' }, track: { sampleRate: 44100 }, envSources: {} })
    const back = JSON.parse(JSON.stringify(sc))
    expect(sanitizeConditions(back.conditions)).toMatchObject({ mic: 'external', noise: 'loud', nativeEnglish: null })
    expect(sanitizeEnv(back.env)).toMatchObject({ sampleRate: 44100, echoCancellation: null })
  })
})

class FakeMic implements MicCapture {
  private onChunk: ((c: Float32Array) => void) | undefined
  readonly sampleRate = 16000
  closed = 0
  trackSettingsCalledBeforeClose = false
  trackSettings = () => {
    this.trackSettingsCalledBeforeClose = this.closed === 0
    return { sampleRate: 48000, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  }
  start(onChunk: (c: Float32Array) => void) {
    this.onChunk = onChunk
  }
  close() {
    this.closed++
  }
  feed(signal: Float32Array) {
    for (const c of chunked(signal, 1024)) this.onChunk?.(c)
  }
}

describe('recordSpeech exposes the mic track settings', () => {
  it('returns trackSettings (read before the mic is closed) when the capture provides them, and omits them otherwise', async () => {
    const mic = new FakeMic()
    const deps: RecorderDeps = { openCapture: () => Promise.resolve(mic), stallTimeoutMs: 60_000 }
    const p = recordSpeech({}, deps)
    await Promise.resolve()
    mic.feed(cat(room(16000, 1), voice(16000, 2, 0.3), room(16000, 3)))
    const rec = await p
    expect(rec.trackSettings).toEqual({ sampleRate: 48000, echoCancellation: false, noiseSuppression: false, autoGainControl: false })
    expect(mic.trackSettingsCalledBeforeClose).toBe(true)

    const plain = new FakeMic()
    // @ts-expect-error a capture without settings support is valid
    plain.trackSettings = undefined
    const p2 = recordSpeech({}, { openCapture: () => Promise.resolve(plain), stallTimeoutMs: 60_000 })
    await Promise.resolve()
    plain.feed(cat(room(16000, 1), voice(16000, 2, 0.3), room(16000, 3)))
    expect('trackSettings' in (await p2)).toBe(false)
  })
})
