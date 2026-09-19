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
      title={retryPending || relaxing ? 'Serious face, lips closed' : smiling ? 'Now smile big. Hold it.' : 'Look at the camera'}
      lede={
        retryPending
          ? 'Keep your lips gently closed with no smile. I will restart the check in a moment.'
          : relaxing
            ? 'A serious, neutral expression, like a passport photo. Take your time; the smile comes next.'
            : smiling
              ? 'As wide as you comfortably can, and keep it there.'
              : 'Fit your face inside the outline. First a serious, neutral face, then I will ask you to smile.'
      }
      footer={<VisionRetryButton test="face" run={testRunner.runFace} />}
    >
      <CameraView guide={<HeadGuide tone={progress?.framingOk ? 'ok' : 'waiting'} />} />
    </TestScreen>
  )
}
