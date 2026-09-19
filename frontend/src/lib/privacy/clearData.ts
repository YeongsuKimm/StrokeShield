// "Clear my data": the one place that forgets everything this tab knows about the visitor (docs/spec/06 "Privacy").
//
// The wipe is a list of independent steps, each guarded, so one failing step (a browser that blocks storage, a
// voice session that is already closed) can never leave the others undone. Dependencies are injected so the
// ordering and the storage sweep are unit-testable without a browser.
import { endAgentSession } from '../agent/agentSession'
import { useRecorder } from '../calibration/recorder'
import { micMonitor } from '../media/micLevel'
import { useSession } from '../session/store'
import { useSpeechRecorder } from '../speech/speechRecorder'
import { speechRunner } from '../speech/speechRunner'
import { useSpeechProgress } from '../speech/speechProgressStore'
import { getVisionEngine } from '../vision/useMediaPipe'
import { testRunner } from '../vision/useTestRunner'

/** The subset of the Web Storage API the wipe needs. */
export interface StorageLike {
  clear(): void
}

export interface ClearDeps {
  /** Abort a running vision check and a running speech recording (drops their captured data unstored). */
  stopRunners: () => void
  /** Hang up the ElevenLabs voice guide. */
  endAgent: () => Promise<void> | void
  /** Stop the microphone stream held since consent. */
  releaseMic: () => void
  /** Stop the camera tracks and close the landmarkers. */
  stopCamera: () => void
  /** Empty the in-memory session (results, transcript, opinions, location, permissions, consent...). */
  resetSession: () => void
  /** Empty in-memory calibration-tool state, which can hold WAV blobs and recording JSON. */
  resetRecorders: () => void
  local: StorageLike | null
  session: StorageLike | null
  /** Delete every IndexedDB database of this origin. Resolves when done; may be absent (older browsers). */
  clearIndexedDb: (() => Promise<void>) | null
}

export interface ClearReport {
  /** Names of steps that threw. Empty means everything was cleared. */
  failed: string[]
}

/** Best-effort IndexedDB wipe: `databases()` is missing in some browsers, in which case nothing of ours is there anyway. */
export async function deleteAllIndexedDbs(idb: Pick<IDBFactory, 'deleteDatabase'> & { databases?: () => Promise<{ name?: string }[]> }): Promise<void> {
  const dbs = (await idb.databases?.()) ?? []
  await Promise.all(
    dbs.map(
      (db) =>
        new Promise<void>((resolve) => {
          if (!db.name) return resolve()
          const req = idb.deleteDatabase(db.name)
          req.onsuccess = req.onerror = req.onblocked = () => resolve()
        }),
    ),
  )
}

function browserStorage(kind: 'localStorage' | 'sessionStorage'): StorageLike | null {
  try {
    return globalThis[kind] ?? null // reading it can throw when site data is blocked
  } catch {
    return null
  }
}

export function defaultClearDeps(): ClearDeps {
  const idb = typeof indexedDB === 'undefined' ? null : indexedDB
  return {
    stopRunners: () => {
      testRunner.cancel()
      speechRunner.cancel()
    },
    // Bounded wait: a socket that will not close must not stop the rest of the wipe.
    endAgent: () => Promise.race([endAgentSession(), new Promise<void>((resolve) => setTimeout(resolve, 1500))]),
    releaseMic: () => micMonitor.release(),
    stopCamera: () => getVisionEngine().stop(),
    resetSession: () => {
      useSession.getState().clearAll()
      useSpeechProgress.getState().reset()
    },
    resetRecorders: () => {
      // Not only the saved runs: the typed subject/notes/conditions are also held in memory (a subject may be a name).
      useRecorder.setState({ runs: [], subject: '', notes: '', conditions: {} })
      useSpeechRecorder.getState().clear()
    },
    local: browserStorage('localStorage'),
    session: browserStorage('sessionStorage'),
    clearIndexedDb: idb ? () => deleteAllIndexedDbs(idb) : null,
  }
}

/**
 * Stop the camera and microphone, hang up the voice guide, and wipe every trace this app holds: in-memory state,
 * localStorage, sessionStorage and IndexedDB. The browser's own camera/microphone/location grants belong to the
 * browser and can only be reset from its address bar; the UI says so.
 */
export async function clearAllLocalData(deps: ClearDeps = defaultClearDeps()): Promise<ClearReport> {
  const failed: string[] = []
  const step = async (name: string, fn: (() => unknown) | null | undefined) => {
    if (!fn) return
    try {
      await fn()
    } catch {
      failed.push(name)
    }
  }
  // Hardware and network first, so nothing can write new data while the rest is being wiped.
  await step('stopRunners', deps.stopRunners)
  await step('endAgent', deps.endAgent)
  await step('releaseMic', deps.releaseMic)
  await step('stopCamera', deps.stopCamera)
  await step('resetRecorders', deps.resetRecorders)
  await step('resetSession', deps.resetSession)
  await step('localStorage', deps.local && (() => deps.local?.clear()))
  await step('sessionStorage', deps.session && (() => deps.session?.clear()))
  await step('indexedDB', deps.clearIndexedDb)
  return { failed }
}
