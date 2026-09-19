import { useEffect } from 'react'
import { useSession } from '../../lib/session/store'
import { useCaptureProgress } from '../../lib/vision/progressStore'
import { testRunner } from '../../lib/vision/useTestRunner'
import { CameraView } from '../CameraView'
import { EyeStimulus } from '../EyeStimulus'
import { HeadGuide } from './StageGuides'
import { TestScreen } from './TestScreen'

/**
 * "Follow the dot." BE-FAST stretch, behind FEATURES.eyesTest.
 *
 * The dot is rendered over the camera stage but OUTSIDE the mirrored layer, so `mirrored` stays false: the patient
 * faces the screen, which makes their own left the screen's left. The stimulus mounts exactly when the capture
 * window opens (progress.phase === 'hold'), which is what lets the analyzer label frames by dot position.
 */
export function EyeTest() {
  const progress = useCaptureProgress((s) => s.progress)
  const running = useCaptureProgress((s) => s.running)

  useEffect(() => {
    void testRunner.runEyes()
    return () => {
      if (useSession.getState().phase !== 'eyes') testRunner.cancel()
    }
  }, [])

  const tracking = running === 'eyes' && progress?.phase === 'hold'

  return (
    <TestScreen
      test="eyes"
      title={tracking ? 'Follow the dot' : 'Keep your head still'}
      lede="Move your eyes only — let your head stay exactly where it is. The dot travels left, then right."
    >
      <CameraView
        guide={<HeadGuide tone={progress?.framingOk ? 'ok' : 'waiting'} />}
        hideGuideWhileCapturing={false}
        overlay={
          tracking ? (
            <div className="pointer-events-none absolute inset-0">
              <EyeStimulus onTargetChange={() => {}} onDone={() => {}} />
            </div>
          ) : null
        }
      />
    </TestScreen>
  )
}
