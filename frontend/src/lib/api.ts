import type { AlertRequest, AlertResponse, HealthResponse, TestResult, VisionOpinion } from './contracts'

// Empty base = same origin (Vite proxies /api to :8000 in dev). Set VITE_API_BASE_URL in production.
const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

/** A non-2xx reply. `status` and `retryAfterS` (the Retry-After header) let callers say WHY, not just "failed". */
export class ApiError extends Error {
  status: number
  retryAfterS?: number
  constructor(message: string, status: number, retryAfterS?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryAfterS = retryAfterS
  }
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 10_000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, signal: ctrl.signal })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const retryAfter = Number(res.headers.get('Retry-After'))
      throw new ApiError(
        String(body.error ?? body.detail ?? `HTTP ${res.status}`),
        res.status,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      )
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  signedUrl: () => request<{ signedUrl: string }>('/api/agent/signed-url'),
  sendAlert: (req: AlertRequest) => request<AlertResponse>('/api/alert', json(req)),
  analyzeSpeech: (wav: Blob, targetPhrase: string) => {
    const form = new FormData()
    form.append('audio', wav, 'speech.wav')
    form.append('target_phrase', targetPhrase)
    return request<TestResult>('/api/speech/analyze', { method: 'POST', body: form })
  },
  secondOpinion: (images: { kind: 'face' | 'arms'; jpegBase64: string }[]) =>
    request<VisionOpinion[]>('/api/vision/second-opinion', json({ images }), 5_000),
}
