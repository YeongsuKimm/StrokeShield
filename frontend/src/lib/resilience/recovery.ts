// Recovery actions shared by the crash screen and the lifecycle handlers. Every step is guarded on its own, so one
// failing step (a camera that will not close) can never stop the others, and none of them can throw.
import { micMonitor } from '../media/micLevel'
import { useSession } from '../session/store'
import { speechRunner } from '../speech/speechRunner'
import { useSpeechProgress } from '../speech/speechProgressStore'
import { getVisionEngine } from '../vision/useMediaPipe'
import { testRunner } from '../vision/useTestRunner'

export interface HardwareDeps {
  cancelRunners: () => void
  stopCamera: () => void
  releaseMic: () => void
}

export const defaultHardwareDeps = (): HardwareDeps => ({
  cancelRunners: () => {
    testRunner.cancel()
    speechRunner.cancel()
  },
  stopCamera: () => getVisionEngine().stop(),
  releaseMic: () => micMonitor.release(),
})

/** Abort any running check and switch the camera and microphone off. Returns the names of steps that failed. */
export function stopHardware(deps: HardwareDeps = defaultHardwareDeps()): string[] {
  const failed: string[] = []
  for (const [name, fn] of Object.entries(deps) as [string, () => void][]) {
    try {
      fn()
    } catch {
      failed.push(name)
    }
  }
  return failed
}

/** Back to a clean idle home screen. Keeps consent and browser permissions (they are facts about the visitor). */
export function startOver(deps: HardwareDeps = defaultHardwareDeps()): void {
  stopHardware(deps)
  try {
    useSpeechProgress.getState().reset()
  } catch {
    /* progress is cosmetic */
  }
  useSession.getState().reset()
}
