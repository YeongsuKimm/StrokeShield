// Typed, human-readable API failures. Every network call in lib/api.ts ends in either data or one of these, so the UI can
// say WHAT went wrong in plain words ("the server took too long") and pick a retry/skip path, instead of showing
// "Error: signal is aborted without reason" or a stack.

export type ApiErrorKind =
  | 'offline' // the browser says there is no network
  | 'timeout' // no answer in time (slow or dead wifi, backend asleep)
  | 'network' // fetch failed outright (DNS, refused, CORS, TLS)
  | 'rate-limited' // HTTP 429
  | 'server' // HTTP 5xx
  | 'client' // other HTTP 4xx (the backend's own message is used when it sent one)
  | 'malformed' // 2xx with a body that is not the JSON we expected

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status?: number
  /** Seconds from the Retry-After header (HTTP 429), so callers can show the wait. */
  readonly retryAfterS?: number
  constructor(kind: ApiErrorKind, message: string, status?: number, retryAfterS?: number) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
    this.retryAfterS = retryAfterS
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError

/** Failures that say "the network / backend is unreachable" (as opposed to "the backend answered, and said no"). */
export const isConnectivityKind = (k: ApiErrorKind): boolean => k === 'offline' || k === 'timeout' || k === 'network'

const MAX_BACKEND_TEXT = 200

/** The backend's own error text, but only when it is a short plain string (never an object dump or a stack). */
export function backendMessage(body: unknown): string | undefined {
  const b = body as { error?: unknown; detail?: unknown } | null
  const v = typeof b?.error === 'string' ? b.error : typeof b?.detail === 'string' ? b.detail : undefined
  return v && v.length <= MAX_BACKEND_TEXT ? v : undefined
}

/** Friendly sentence for a failure. `what` is the thing that failed, e.g. "the alert" or "the speech analysis". */
export function friendlyMessage(kind: ApiErrorKind, what = 'that request', detail?: string): string {
  switch (kind) {
    case 'offline':
      return `You seem to be offline, so ${what} could not go through.`
    case 'timeout':
      return `The server took too long to answer, so ${what} could not finish.`
    case 'network':
      return `Could not reach the server, so ${what} could not go through.`
    case 'rate-limited':
      return 'The server is busy right now. Wait a few seconds and try again.'
    case 'server':
      return `The server ran into a problem, so ${what} did not finish.`
    case 'malformed':
      return `The server sent back something unexpected, so ${what} did not finish.`
    case 'client':
      return detail ? `${what[0].toUpperCase()}${what.slice(1)} was refused: ${detail}` : `The server refused ${what}.`
  }
}

/** Kind for an HTTP status. */
export function kindForStatus(status: number): ApiErrorKind {
  if (status === 429) return 'rate-limited'
  if (status >= 500) return 'server'
  return 'client'
}

/** Kind for a thrown fetch failure. `timedOut` = our own timer aborted it. */
export function kindForThrown(e: unknown, opts: { timedOut: boolean; online: boolean }): ApiErrorKind {
  if (opts.timedOut) return 'timeout'
  if (!opts.online) return 'offline'
  const name = (e as { name?: string } | null)?.name
  if (name === 'AbortError') return 'timeout' // aborted by something else (still means no answer)
  return 'network'
}
