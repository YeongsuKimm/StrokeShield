import type { AlertRequest, AlertResponse, HealthResponse, TestResult, VisionOpinion } from './contracts'
import { ApiError, backendMessage, friendlyMessage, kindForStatus, kindForThrown } from './resilience/apiErrors'
import { useNetwork } from './resilience/network'
import type { Locale } from './i18n'

// Empty base = same origin (Vite proxies /api to :8000 in dev). Set VITE_API_BASE_URL in production.
const BASE = import.meta.env?.VITE_API_BASE_URL ?? ''

/**
 * Every call has a timeout, so a dead backend or bad wifi can never leave a spinner up forever. Values are generous
 * enough for a slow venue network but short enough that the patient is told something within a breath.
 */
export const API_TIMEOUTS_MS = {
  health: 4_000,
  signedUrl: 6_000,
  alert: 20_000, // never auto-retried (a lost response must not become a second text), so give it room
  speech: 25_000, // up to 5 MB upload + DSP (+ the optional phoneme model)
  secondOpinion: 8_000,
} as const

interface RequestOptions {
  timeoutMs: number
  /** What the call does, in words that fit "…so ${what} could not go through". */
  what: string
  /** GET-style calls only: extra attempts after a connectivity failure or a 5xx. Never set this on the alert. */
  retries?: number
  retryDelayMs?: number
}

const isOnline = (): boolean => {
  try {
    return typeof navigator === 'undefined' || navigator.onLine !== false
  } catch {
    return true
  }
}

async function attempt<T>(path: string, init: RequestInit | undefined, o: RequestOptions): Promise<T> {
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, o.timeoutMs)
  try {
    let res: Response
    try {
      res = await fetch(`${BASE}${path}`, { ...init, signal: ctrl.signal })
    } catch (e) {
      const kind = kindForThrown(e, { timedOut, online: isOnline() })
      throw new ApiError(kind, friendlyMessage(kind, o.what))
    }
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => undefined)
      const kind = kindForStatus(res.status)
      const retryAfter = Number(res.headers?.get?.('Retry-After'))
      throw new ApiError(kind, friendlyMessage(kind, o.what, backendMessage(body)), res.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined)
    }
    try {
      return (await res.json()) as T
    } catch {
      // The body may still be streaming when our timer fires.
      const kind = timedOut ? 'timeout' : 'malformed'
      throw new ApiError(kind, friendlyMessage(kind, o.what), res.status)
    }
  } finally {
    clearTimeout(timer)
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function request<T>(path: string, init: RequestInit | undefined, o: RequestOptions): Promise<T> {
  const tries = 1 + Math.max(0, o.retries ?? 0)
  let last: ApiError | undefined
  for (let i = 0; i < tries; i++) {
    try {
      const data = await attempt<T>(path, init, o)
      useNetwork.getState().record({ ok: true })
      return data
    } catch (e) {
      last = e instanceof ApiError ? e : new ApiError('network', friendlyMessage('network', o.what))
      useNetwork.getState().record({ ok: false, kind: last.kind })
      const retryable = last.kind === 'offline' || last.kind === 'timeout' || last.kind === 'network' || last.kind === 'server'
      if (!retryable || i === tries - 1) break
      await wait(o.retryDelayMs ?? 600)
    }
  }
  throw last
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  health: () => request<HealthResponse>('/api/health', undefined, { timeoutMs: API_TIMEOUTS_MS.health, what: 'the server check' }),
  signedUrl: (lang: Locale = 'en') =>
    request<{ signedUrl: string }>(`/api/agent/signed-url?lang=${lang}`, undefined, {
      timeoutMs: API_TIMEOUTS_MS.signedUrl,
      what: 'the voice guide',
      retries: 1,
    }),
  // No retries: a response lost after the server sent the text would otherwise send a second one.
  sendAlert: (req: AlertRequest) =>
    request<AlertResponse>('/api/alert', json(req), { timeoutMs: API_TIMEOUTS_MS.alert, what: 'the alert' }),
  analyzeSpeech: (wav: Blob, targetPhrase: string, lang: Locale = 'en') => {
    const form = new FormData()
    form.append('audio', wav, 'speech.wav')
    form.append('target_phrase', targetPhrase)
    form.append('lang', lang)
    return request<TestResult>('/api/speech/analyze', { method: 'POST', body: form }, { timeoutMs: API_TIMEOUTS_MS.speech, what: 'the speech analysis' })
  },
  secondOpinion: (images: { kind: 'face' | 'arms'; jpegBase64: string }[]) =>
    request<VisionOpinion[]>('/api/vision/second-opinion', json({ images }), {
      timeoutMs: API_TIMEOUTS_MS.secondOpinion,
      what: 'the second opinion',
    }),
}
