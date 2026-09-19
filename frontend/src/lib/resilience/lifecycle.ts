// Page lifecycle: tab hidden mid-check, page leaving, and the screen wake lock. All dependencies are injected so the
// behaviour is unit-testable and countable (listeners added == listeners removed; lock acquired == released).
//
//  * Tab hidden during a check  -> abort the run (nothing half-captured is stored), switch the camera off, remember
//    which check it was. Tab visible again on the same screen -> restart that check automatically for the camera
//    checks; for speech the patient presses Start recording again (the recorder needs a deliberate press). A clear
//    message says what happened (`useLifecycle.interrupted`, rendered by ResumeNotice).
//  * The countdown / alert are NEVER paused: a hidden tab must not delay help.
//  * pagehide / beforeunload    -> stop the camera and microphone tracks.
//  * The screen stays awake during checks and the alert (Screen Wake Lock, best effort).
import { create } from 'zustand'
import type { TestName } from '../contracts'
import { isTestPhase, useSession, type Phase } from '../session/store'
import { defaultHardwareDeps, stopHardware, type HardwareDeps } from './recovery'
import { browserWakeLock, createWakeLock, type WakeLockController } from './wakeLock'

interface LifecycleState {
  /** The check that was cut short because the tab went into the background; null when nothing is waiting to resume. */
  interrupted: TestName | null
  /** True once the tab is back and a camera check has been restarted (the notice then fades on a timer). */
  resumed: boolean
  set: (t: TestName | null, resumed?: boolean) => void
}
export const useLifecycle = create<LifecycleState>((set) => ({
  interrupted: null,
  resumed: false,
  set: (interrupted, resumed = false) => set({ interrupted, resumed }),
}))

type Target = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
type DocTarget = Target & { visibilityState?: string }

export interface LifecycleDeps {
  doc: DocTarget
  win: Target
  hardware: HardwareDeps
  wakeLock: WakeLockController
  /** Restart a camera check after the tab came back. Speech is deliberately not auto-restarted. */
  resume: (test: TestName) => void
}

/** Phases during which the screen must stay on: a check is running, or help is being called. */
export const keepsScreenAwake = (p: Phase): boolean => isTestPhase(p) || p === 'countdown' || p === 'alerting'

export function installLifecycle(deps: LifecycleDeps): () => void {
  const state = () => useSession.getState()

  const syncWakeLock = () => (keepsScreenAwake(state().phase) ? deps.wakeLock.hold() : deps.wakeLock.drop())
  syncWakeLock()
  const unsub = useSession.subscribe((s, prev) => {
    if (s.phase !== prev.phase) {
      syncWakeLock()
      // Moving on (or skipping) clears any pending "paused" notice for the previous check.
      if (useLifecycle.getState().interrupted && s.phase !== useLifecycle.getState().interrupted) useLifecycle.getState().set(null)
    }
  })

  const onVisibility = () => {
    if (deps.doc.visibilityState === 'hidden') {
      const { phase, route } = state()
      if (isTestPhase(phase) && route === 'home') {
        useLifecycle.getState().set(phase as TestName)
        stopHardware({ ...deps.hardware, releaseMic: () => undefined }) // the microphone belongs to the guide/consent too
      }
      return
    }
    deps.wakeLock.onVisible()
    const t = useLifecycle.getState().interrupted
    if (!t) return
    const { phase, route } = state()
    if (phase === t && route === 'home') {
      // Camera checks restart now (the notice fades by itself, see ResumeNotice); for speech the notice stays until the
      // patient records again or moves on.
      if (t !== 'speech') {
        useLifecycle.getState().set(t, true)
        deps.resume(t)
      }
    } else {
      useLifecycle.getState().set(null)
    }
  }

  const onLeave = () => {
    stopHardware(deps.hardware)
    deps.wakeLock.drop()
  }

  deps.doc.addEventListener('visibilitychange', onVisibility)
  deps.win.addEventListener('pagehide', onLeave)
  deps.win.addEventListener('beforeunload', onLeave)
  return () => {
    deps.doc.removeEventListener('visibilitychange', onVisibility)
    deps.win.removeEventListener('pagehide', onLeave)
    deps.win.removeEventListener('beforeunload', onLeave)
    unsub()
    deps.wakeLock.drop()
    useLifecycle.getState().set(null)
  }
}

/** Real-browser wiring. Imported lazily by App so tests never touch the DOM. */
export function installBrowserLifecycle(resume: (test: TestName) => void): () => void {
  return installLifecycle({
    doc: document,
    win: window,
    hardware: defaultHardwareDeps(),
    wakeLock: createWakeLock(browserWakeLock),
    resume,
  })
}
