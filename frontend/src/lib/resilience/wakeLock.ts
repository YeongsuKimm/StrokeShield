// Screen wake lock: keep the screen (and camera preview) on while a check or the alert is running. Purely a comfort
// feature: every failure (unsupported browser, battery saver, page hidden) is swallowed, and the lock is always released
// when the checks end. The controller takes its dependencies as arguments so it can be counted in tests.

export interface WakeLockSentinelLike {
  release(): Promise<void>
  addEventListener?(type: 'release', fn: () => void): void
}
export interface WakeLockApi {
  request(type: 'screen'): Promise<WakeLockSentinelLike>
}

export interface WakeLockController {
  /** Ask for the lock to be held (idempotent). */
  hold(): void
  /** Let it go (idempotent). */
  drop(): void
  /** Page became visible again: the browser drops the lock while hidden, so take it back if still wanted. */
  onVisible(): void
  readonly wanted: boolean
  readonly held: boolean
}

export function createWakeLock(api: () => WakeLockApi | undefined): WakeLockController {
  let wanted = false
  let sentinel: WakeLockSentinelLike | null = null
  let pending = false

  const acquire = () => {
    if (!wanted || sentinel || pending) return
    const wl = api()
    if (!wl) return
    pending = true
    let p: Promise<WakeLockSentinelLike>
    try {
      p = wl.request('screen')
    } catch {
      pending = false
      return
    }
    p.then(
      (s) => {
        pending = false
        if (!wanted) {
          void s.release().catch(() => undefined) // dropped while the request was in flight
          return
        }
        sentinel = s
        s.addEventListener?.('release', () => {
          if (sentinel === s) sentinel = null
        })
      },
      () => {
        pending = false // denied (battery saver, hidden page): just carry on without it
      },
    )
  }

  const release = () => {
    const s = sentinel
    sentinel = null
    if (s) void s.release().catch(() => undefined)
  }

  return {
    hold() {
      wanted = true
      acquire()
    },
    drop() {
      wanted = false
      release()
    },
    onVisible() {
      acquire()
    },
    get wanted() {
      return wanted
    },
    get held() {
      return sentinel !== null
    },
  }
}

export const browserWakeLock = (): WakeLockApi | undefined => {
  try {
    return (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock
  } catch {
    return undefined
  }
}
