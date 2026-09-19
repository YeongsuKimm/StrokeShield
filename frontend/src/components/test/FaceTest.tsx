import { useEffect } from 'react'
import { useCaptureProgress } from '../../lib/vision/progressStore'
import { isVisionScreenActive, runVisionWithOneRetry } from '../../lib/vision/retry'
import { testRunner } from '../../lib/vision/useTestRunner'
import { CameraView } from '../CameraView'
import { HeadGuide } from './StageGuides'
import { TestScreen } from './TestScreen'
import { VisionRetryButton } from './VisionRetryButton'

/**
 * "Smile." Starts the face capture as soon as the screen appears: the framing gate holds it until the patient is
 * actually in shot, so there is nothing for them to press.
 */
export function FaceTest() {
  const progress = useCaptureProgress((s) => s.progress)
  const running = useCaptureProgress((s) => s.running)
  const retryPending = useCaptureProgress((s) => s.retryPending === 'face')

  useEffect(() => {
    void runVisionWithOneRetry(testRunner.runFace, () => isVisionScreenActive('face'))
    return () => {
      // Survives StrictMode's double-mount: only stop the run if the patient has really left this check (next step,
      // skip, or the info page, which unmounts the screen without changing the phase).
      if (!isVisionScreenActive('face')) testRunner.cancel()
    }
  }, [])

  const phase = running === 'face' ? progress?.phase : undefined
  const smiling = phase === 'smile'
  const relaxing = phase === 'neutral'

  return (
    <TestScreen
      test="face"
      title={retryPending || relaxing ? 'Relax your face' : smiling ? 'Now smile big. Hold it.' : 'Smile as wide as you can'}
      lede={
        retryPending
          ? 'Let your mouth rest completely. I will restart the check in a moment.'
          : relaxing
            ? 'Let your mouth rest. Take your time; a big smile is next.'
            : smiling
              ? 'As wide as you comfortably can, and keep it there.'
              : 'Fit your face inside the outline. I will ask you to relax first, then smile.'
      }
      footer={<VisionRetryButton test="face" run={testRunner.runFace} />}
    >
      <CameraView guide={<HeadGuide tone={progress?.framingOk ? 'ok' : 'waiting'} />} />
    </TestScreen>
  )
}
