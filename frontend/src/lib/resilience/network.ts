// Connectivity awareness: navigator.onLine (fast but optimistic: it says "online" behind a dead router) plus a
// failed-request heuristic (two connectivity failures in a row with no success in between => "unreachable").
// Pure decision function + a tiny store, so the banner logic is unit-testable without a browser.
import { create } from 'zustand'
import { isConnectivityKind, type ApiErrorKind } from './apiErrors'

export type Connectivity = 'ok' | 'offline' | 'unreachable'

/** Two failed requests in a row is a pattern; one can be a blip. */
export const UNREACHABLE_AFTER_FAILURES = 2

export function connectivityOf(s: { online: boolean; failStreak: number }): Connectivity {
  if (!s.online) return 'offline'
  return s.failStreak >= UNREACHABLE_AFTER_FAILURES ? 'unreachable' : 'ok'
}

interface NetState {
  online: boolean
  failStreak: number
  setOnline: (online: boolean) => void
  /** Called by lib/api.ts after every request. Only connectivity-type failures count; a 4xx means the server answered. */
  record: (outcome: { ok: true } | { ok: false; kind: ApiErrorKind }) => void
}

const browserOnline = (): boolean => {
  try {
    return typeof navigator === 'undefined' || navigator.onLine !== false
  } catch {
    return true
  }
}

export const useNetwork = create<NetState>((set) => ({
  online: browserOnline(),
  failStreak: 0,
  // Coming back online clears the streak: the banner should not outlive the outage.
  setOnline: (online) => set(online ? { online, failStreak: 0 } : { online }),
  record: (outcome) =>
    set((s) => {
      if (outcome.ok || !isConnectivityKind(outcome.kind)) return s.failStreak === 0 ? s : { failStreak: 0 }
      return { failStreak: s.failStreak + 1 }
    }),
}))

/** Wire browser online/offline events into the store. Returns the cleanup. */
export function installConnectivityListeners(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  const on = () => useNetwork.getState().setOnline(true)
  const off = () => useNetwork.getState().setOnline(false)
  target.addEventListener('online', on)
  target.addEventListener('offline', off)
  return () => {
    target.removeEventListener('online', on)
    target.removeEventListener('offline', off)
  }
}

export const getConnectivity = (): Connectivity => connectivityOf(useNetwork.getState())
