// Turns "the alert did not go through" into something a stressed person can act on. Pure: no DOM, no network.
//
// Two sources of failure reach the store as an `AlertResponse{ok:false}`: the server's own refusal (HTTP 200 with
// `error`, see services/twilio_service.py) and a transport failure caught in the browser (`failureFromError`, which
// writes a recognisable prefix). `describeAlertFailure` maps either to a category + plain wording. Call 911 is always
// the primary action next to it; this text never claims a text arrived when it did not.
import type { AlertResponse } from './contracts'

export type AlertFailureCategory = 'network' | 'rate_limited' | 'server' | 'not_configured' | 'refused' | 'delivery'

export interface AlertFailure {
  category: AlertFailureCategory
  /** Short heading. */
  title: string
  /** One or two plain sentences: what happened and what to do. */
  detail: string
  /** Seconds the patient must wait before a retry can succeed; 0 = retry now. */
  retryAfterS: number
}

/** The server allows one live alert per 2 minutes (services/twilio_service.MIN_SECONDS_BETWEEN_ALERTS). */
export const SERVER_ALERT_COOLDOWN_S = 120

/** Best-effort conversion of anything thrown by `api.sendAlert` into a failed AlertResponse. */
export function failureFromError(e: unknown): AlertResponse {
  // `kind` is set by lib/api.ts's typed ApiError (offline / timeout / network / ...): transport failures have no status.
  const err = e as { name?: string; kind?: unknown; status?: unknown; retryAfterS?: unknown; message?: unknown } | null
  const status = typeof err?.status === 'number' ? err.status : undefined
  if (status === 429) {
    const wait = typeof err?.retryAfterS === 'number' ? err.retryAfterS : parseSeconds(String(err?.message ?? ''))
    return { ok: false, dryRun: false, error: `too many requests: try again in ${wait ?? 60} s` }
  }
  if (status !== undefined && status >= 500) return { ok: false, dryRun: false, error: `server error (HTTP ${status})` }
  if (status !== undefined) return { ok: false, dryRun: false, error: `request rejected (HTTP ${status})` }
  if (err?.kind === 'offline') return { ok: false, dryRun: false, error: 'network: you seem to be offline' }
  if (err?.kind === 'timeout' || err?.name === 'AbortError') return { ok: false, dryRun: false, error: 'network: the server did not answer in time' }
  return { ok: false, dryRun: false, error: 'network: could not reach the server' }
}

function parseSeconds(text: string): number | undefined {
  const m = /(\d{1,4})\s*s\b/.exec(text)
  return m ? Number(m[1]) : undefined
}

/** A server message is shown only when it is short plain prose; stack-trace-like or "TypeError: Failed to fetch" text never is. */
function friendlyServerMessage(raw: string): boolean {
  return raw.length > 0 && raw.length <= 80 && !/^\w*(Error|Exception)\b/.test(raw) && !/failed to fetch/i.test(raw)
}

export function describeAlertFailure(res: AlertResponse | undefined): AlertFailure {
  const raw = (res?.error ?? '').trim()
  const text = raw.toLowerCase()

  if (text.startsWith('network:')) {
    return {
      category: 'network',
      title: 'Could not reach the alert server',
      detail: 'No text was sent. Check the internet connection and try again.',
      retryAfterS: 0,
    }
  }
  if (text.includes('sent in the last 2 minutes')) {
    return {
      category: 'rate_limited',
      title: 'An alert was already sent in the last 2 minutes',
      detail: 'The server sends one text every 2 minutes, so the demo phone most likely already has it. You can send again after the wait.',
      retryAfterS: SERVER_ALERT_COOLDOWN_S,
    }
  }
  if (text.includes('too many requests') || text.includes('rate limited')) {
    const wait = parseSeconds(text) ?? 60
    return {
      category: 'rate_limited',
      title: 'Too many alert attempts',
      detail: `The server is limiting requests. Wait about ${wait} seconds, then try again.`,
      retryAfterS: wait,
    }
  }
  if (text.startsWith('server error') || text.includes('internal error')) {
    return {
      category: 'server',
      title: 'The alert server had a problem',
      detail: 'No text was confirmed sent. Try again in a moment.',
      retryAfterS: 0,
    }
  }
  if (text.startsWith('request rejected')) {
    return {
      category: 'server',
      title: 'The alert server rejected the request',
      detail: 'No text was sent. Try once more; if it fails again, call 911 yourself.',
      retryAfterS: 0,
    }
  }
  if (text.includes('below threshold') || text.includes('alert refused')) {
    return {
      category: 'refused',
      title: 'The server declined to send the alert',
      detail: 'The check results were below its alert level. Use "Send the text" to ask for help yourself.',
      retryAfterS: 0,
    }
  }
  if (/not (set|configured)|needs a us|credentials/.test(text)) {
    return {
      category: 'not_configured',
      title: 'Alerts are not set up on this server',
      detail: 'No text can be sent from here. Call 911 yourself.',
      retryAfterS: 0,
    }
  }
  return {
    category: 'delivery',
    title: 'The text could not be delivered',
    detail: friendlyServerMessage(raw) ? `${raw}. No text was confirmed sent.` : 'No text was confirmed sent.',
    retryAfterS: 0,
  }
}

/** True when the response is the honest "server only logged it" outcome (DRY_RUN): nothing left the server. */
export function isDemoNothingSent(res: AlertResponse | undefined): boolean {
  return !!res && res.ok && res.dryRun
}

/** m:ss for the retry cooldown. */
export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
