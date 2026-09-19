// Global error capture. Logs a SANITISED line (error name + short message with digit runs and emails blanked, never
// a stack, a payload, a transcript or a location) to console.debug, keeps the last few in memory for the crash screen
// and the preflight panel, and never throws. Nothing is sent anywhere.
import { create } from 'zustand'

export interface LoggedError {
  source: 'error' | 'unhandledrejection' | 'boundary'
  name: string
  message: string
  at: number
}

const MAX_KEPT = 8
const MAX_MESSAGE = 160

/** Blank anything that could be personal: long digit runs (phone numbers, coordinates), emails, URL query strings. */
export function scrub(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\?[^\s"')]*/g, '?[query]')
    .replace(/\d[\d\s().+-]{5,}\d/g, '[digits]')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_MESSAGE)
}

interface ErrorLogState {
  recent: LoggedError[]
  total: number
  push: (e: LoggedError) => void
  clear: () => void
}

export const useErrorLog = create<ErrorLogState>((set) => ({
  recent: [],
  total: 0,
  push: (e) => set((s) => ({ recent: [...s.recent, e].slice(-MAX_KEPT), total: s.total + 1 })),
  clear: () => set({ recent: [], total: 0 }),
}))

export function describeError(e: unknown): { name: string; message: string } {
  if (e instanceof Error) return { name: e.name || 'Error', message: scrub(e.message) }
  if (typeof e === 'string') return { name: 'Error', message: scrub(e) }
  const o = e as { name?: unknown; message?: unknown } | null
  return {
    name: typeof o?.name === 'string' ? o.name : 'Unknown',
    message: typeof o?.message === 'string' ? scrub(o.message) : '',
  }
}

/** True for a failed lazy-chunk import (offline / stale deploy). The fix is "check your connection and reload". */
export function isChunkLoadError(e: unknown): boolean {
  const { name, message } = describeError(e)
  return /ChunkLoadError|dynamically imported module|Importing a module script failed|error loading dynamically/i.test(`${name} ${message}`)
}

export function recordError(source: LoggedError['source'], e: unknown, now: () => number = Date.now): LoggedError {
  const { name, message } = describeError(e)
  const entry: LoggedError = { source, name, message, at: now() }
  try {
    useErrorLog.getState().push(entry)
    console.debug(`[app] ${source}: ${name}${message ? ` - ${message}` : ''}`)
  } catch {
    /* logging must never throw */
  }
  return entry
}

type ErrorTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

/**
 * `error` and `unhandledrejection` listeners. They only LOG: an uncaught error outside React rendering leaves the page
 * fully interactive (React render errors are caught by ErrorBoundary), so there is nothing to "recover"; what matters is
 * that it is visible to a developer and that it can never itself throw or loop.
 */
export function installGlobalErrorHandlers(target: ErrorTarget = window): () => void {
  const onError = (ev: Event) => {
    const e = ev as ErrorEvent
    // Resource load failures (an <img>/<script> tag) reach here with no `error`; still worth one line.
    recordError('error', e.error ?? e.message ?? 'resource error')
  }
  const onRejection = (ev: Event) => {
    recordError('unhandledrejection', (ev as PromiseRejectionEvent).reason)
  }
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}
