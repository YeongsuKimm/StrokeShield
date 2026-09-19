import { beforeEach, describe, expect, it } from 'vitest'
import type { TestResult } from '../contracts'
import { collectEnv, conditionsFor, collectSpeechEnv } from './deviceProfile'
import { isSpeechRecordSearch, isVisionRecordSearch, recordMode, recordRun, useRecorder } from './recorder'
import { parseRecording, sanitizeConditions, sanitizeEnv, validateRecording, type RecordingInputs } from './recording'

const liveResult: TestResult = { test: 'face', severity: 0.1, confidence: 0.9, metrics: {}, flags: [], startedAt: 1, durationMs: 2 }
const inputs: RecordingInputs = { kind: 'face', neutral: [], smile: [] }

describe('deviceProfile', () => {
  it('collects the vision env from injected sources, with null for unknown nullable fields', () => {
    const env = collectEnv({
      userAgent: 'UA/1',
      hardwareConcurrency: 8,
      deviceMemory: 16,
      screen: { width: 1920, height: 1080 },
      vision: { delegate: 'GPU', fps: 19.63, videoSize: { w: 1280, h: 720 } },
    })
    expect(env).toEqual({ userAgent: 'UA/1', hardwareConcurrency: 8, deviceMemoryGB: 16, screen: '1920x1080', delegate: 'GPU', fps: 19.6, videoSize: '1280x720' })
    expect(collectEnv({})).toEqual({ deviceMemoryGB: null, delegate: null, fps: null, videoSize: null })
    expect(collectEnv({ vision: { delegate: null, fps: 0, videoSize: null } })).toMatchObject({ delegate: null, fps: null, videoSize: null })
  })

  it('speech env carries the track settings, null when the recorder could not report them', () => {
    expect(collectSpeechEnv({ userAgent: 'UA' }, { sampleRate: 48000, echoCancellation: true, noiseSuppression: false, autoGainControl: false })).toEqual({
      userAgent: 'UA',
      deviceMemoryGB: null,
      sampleRate: 48000,
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
    })
    expect(collectSpeechEnv({}, undefined)).toEqual({ deviceMemoryGB: null, sampleRate: null, echoCancellation: null, noiseSuppression: null, autoGainControl: null })
  })

  it('conditionsFor keeps only the keys of one side and fills the rest with null', () => {
    expect(conditionsFor('vision', { glasses: true, mic: 'headset' })).toEqual({ glasses: true, facialHair: null, lighting: null, distanceM: null, device: null })
    expect(conditionsFor('speech', {})).toEqual({ mic: null, noise: null, nativeEnglish: null, device: null })
  })
})

describe('recordRun attaches conditions and env', () => {
  beforeEach(() => useRecorder.setState({ enabled: true, subject: 'Sam', autoDownload: false, runs: [], conditions: {} }))

  it('writes the vision conditions typed in the panel and the injected env into the recording JSON', () => {
    useRecorder.getState().setConditions({ glasses: true, lighting: 'dim', distanceM: 0.6, device: 'thinkpad x1', mic: 'headset' })
    recordRun(inputs, liveResult, () => ({ userAgent: 'UA/1', delegate: 'CPU', fps: 15, videoSize: '640x480' }))
    const rec = parseRecording(useRecorder.getState().runs[0].json)
    expect(rec.conditions).toEqual({ glasses: true, facialHair: null, lighting: 'dim', distanceM: 0.6, device: 'thinkpad x1' })
    expect(rec.env).toEqual({ userAgent: 'UA/1', delegate: 'CPU', fps: 15, videoSize: '640x480' })
  })

  it('nothing entered gives nulls (not missing keys) and the recording still loads', () => {
    recordRun(inputs, liveResult, () => ({}))
    const rec = parseRecording(useRecorder.getState().runs[0].json)
    expect(rec.conditions).toEqual({ glasses: null, facialHair: null, lighting: null, distanceM: null, device: null })
  })

  it('an env collector that throws never breaks the run (nothing saved, no exception)', () => {
    expect(() =>
      recordRun(inputs, liveResult, () => {
        throw new Error('no camera')
      }),
    ).not.toThrow()
  })

  it('does nothing when recording is not enabled', () => {
    useRecorder.setState({ enabled: false })
    recordRun(inputs, liveResult, () => ({}))
    expect(useRecorder.getState().runs).toHaveLength(0)
  })
})

describe('recording query modes', () => {
  it('separates speech and vision panels while preserving the legacy combined mode', () => {
    expect(recordMode('?record=speech')).toBe('speech')
    expect(isSpeechRecordSearch('?record=speech')).toBe(true)
    expect(isVisionRecordSearch('?record=speech')).toBe(false)
    expect(isVisionRecordSearch('?record=vision')).toBe(true)
    expect(isSpeechRecordSearch('?record=vision')).toBe(false)
    expect(isVisionRecordSearch('?record=1')).toBe(true)
    expect(isSpeechRecordSearch('?record=1')).toBe(true)
    expect(recordMode('')).toBeNull()
  })
})

describe('tolerant reading of conditions / env', () => {
  it('drops unknown keys and wrongly typed values, keeps nulls', () => {
    expect(sanitizeConditions({ glasses: 'yes', facialHair: null, lighting: 'blinding', distanceM: '0.6', device: 5, mic: 'headset', extra: 1 })).toEqual({ facialHair: null, mic: 'headset' })
    expect(sanitizeConditions('nope')).toBeUndefined()
    expect(sanitizeConditions([1])).toBeUndefined()
    expect(sanitizeEnv({ userAgent: 3, hardwareConcurrency: 4, delegate: 'GPU', bogus: true, fps: NaN })).toEqual({ hardwareConcurrency: 4, delegate: 'GPU' })
    expect(sanitizeEnv(undefined)).toBeUndefined()
  })

  it('old recordings without the fields load unchanged; malformed fields are ignored, not fatal', () => {
    const old = { schema: 1, id: 'x', createdAt: 't', subject: 's', scenario: 'a', expected: 'healthy', expectedSide: 'none', notes: '', inputs: { kind: 'face', neutral: [], smile: [] }, liveResult }
    const rec = validateRecording(old)
    expect(rec.conditions).toBeUndefined()
    expect(rec.env).toBeUndefined()
    const odd = validateRecording({ ...old, conditions: 'garbage', env: [1, 2] })
    expect('conditions' in odd).toBe(false)
    expect('env' in odd).toBe(false)
    const good = validateRecording({ ...old, conditions: { glasses: false, unknown: 1 }, env: { delegate: 'GPU', nope: 1 } })
    expect(good.conditions).toEqual({ glasses: false })
    expect(good.env).toEqual({ delegate: 'GPU' })
  })
})
