// Pure helpers that turn "what the browser told us" into the `env` / `conditions` fields of a recording (schema in
// recording.ts). Sources are injected so tests never need a DOM; the browser reading lives in `browserEnvSources`.
import type { Conditions, RecordingEnv } from './recording'

export interface EnvSources {
  userAgent?: string
  hardwareConcurrency?: number
  /** navigator.deviceMemory (GB, Chromium only). */
  deviceMemory?: number
  screen?: { width: number; height: number }
  /** Vision runtime summary (delegate GPU/CPU, measured fps, video size). */
  vision?: { delegate?: string | null; fps?: number | null; videoSize?: { w: number; h: number } | null }
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** Vision `env`: everything the spec lists, nullable fields are null (never undefined) when unknown. */
export function collectEnv(src: EnvSources): RecordingEnv {
  const v = src.vision
  return {
    ...(src.userAgent ? { userAgent: src.userAgent } : {}),
    ...(finite(src.hardwareConcurrency) ? { hardwareConcurrency: src.hardwareConcurrency } : {}),
    deviceMemoryGB: finite(src.deviceMemory) ? src.deviceMemory : null,
    ...(src.screen ? { screen: `${src.screen.width}x${src.screen.height}` } : {}),
    delegate: v?.delegate ?? null,
    fps: finite(v?.fps) && (v?.fps ?? 0) > 0 ? Math.round((v?.fps ?? 0) * 10) / 10 : null,
    videoSize: v?.videoSize ? `${v.videoSize.w}x${v.videoSize.h}` : null,
  }
}

/** Reads the real browser globals (each guarded: any of them may be missing). Pass the current vision summary in. */
export function browserEnvSources(vision?: EnvSources['vision']): EnvSources {
  const nav = (globalThis.navigator ?? undefined) as (Navigator & { deviceMemory?: number }) | undefined
  const scr = globalThis.screen as Screen | undefined
  return {
    userAgent: nav?.userAgent,
    hardwareConcurrency: nav?.hardwareConcurrency,
    deviceMemory: nav?.deviceMemory,
    screen: scr ? { width: scr.width, height: scr.height } : undefined,
    vision,
  }
}

/** Speech `env` from `MediaTrackSettings` (or the subset the recorder exposes) plus the same browser info. */
export interface TrackSettingsLite {
  sampleRate?: number
  echoCancellation?: boolean
  noiseSuppression?: boolean
  autoGainControl?: boolean
}

export function collectSpeechEnv(src: EnvSources, track?: TrackSettingsLite | null): RecordingEnv {
  const base = collectEnv({ ...src, vision: undefined })
  return {
    ...(base.userAgent ? { userAgent: base.userAgent } : {}),
    ...(base.hardwareConcurrency !== undefined ? { hardwareConcurrency: base.hardwareConcurrency } : {}),
    deviceMemoryGB: base.deviceMemoryGB ?? null,
    ...(base.screen ? { screen: base.screen } : {}),
    sampleRate: finite(track?.sampleRate) ? track.sampleRate : null,
    echoCancellation: typeof track?.echoCancellation === 'boolean' ? track.echoCancellation : null,
    noiseSuppression: typeof track?.noiseSuppression === 'boolean' ? track.noiseSuppression : null,
    autoGainControl: typeof track?.autoGainControl === 'boolean' ? track.autoGainControl : null,
  }
}

export const VISION_CONDITION_KEYS = ['glasses', 'facialHair', 'lighting', 'distanceM', 'device'] as const
export const SPEECH_CONDITION_KEYS = ['mic', 'noise', 'nativeEnglish', 'device'] as const

/** Only the keys relevant to one side, every one present (null when not entered), so old/partial UI state never yields undefined holes. */
export function conditionsFor(side: 'vision' | 'speech', c: Conditions): Conditions {
  const keys = side === 'vision' ? VISION_CONDITION_KEYS : SPEECH_CONDITION_KEYS
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k] = c[k] ?? null
  return out as Conditions
}
