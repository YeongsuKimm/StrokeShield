import { useEffect } from 'react'
import { useSession } from '../../lib/session/store'
import { useCaptureProgress } from '../../lib/vision/progressStore'
import { runVisionWithOneRetry } from '../../lib/vision/retry'
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

  useEffect(() => {
    void runVisionWithOneRetry(testRunner.runFace, () => useSession.getState().phase === 'face')
    return () => {
      // Survives StrictMode's double-mount: only stop the run if the session has really moved off this check.
      if (useSession.getState().phase !== 'face') testRunner.cancel()
    }
  }, [])

  const smiling = running === 'face' && progress?.phase === 'smile'

  return (
    <TestScreen
      test="face"
      title={smiling ? 'Smile — hold it' : 'Smile as wide as you can'}
      lede="Fit your face inside the outline. I will count you in, then ask you to relax first and smile after."
      footer={<VisionRetryButton test="face" run={testRunner.runFace} />}
    >
      <CameraView guide={<HeadGuide tone={progress?.framingOk ? 'ok' : 'waiting'} />} />
    </TestScreen>
  )
}
