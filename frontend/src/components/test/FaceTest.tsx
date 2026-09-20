import { useEffect } from 'react'
import { useCaptureProgress } from '../../lib/vision/progressStore'
import { isVisionScreenActive, runVisionWithOneRetry } from '../../lib/vision/retry'
import { testRunner } from '../../lib/vision/useTestRunner'
import { CameraView } from '../CameraView'
import { HeadGuide } from './StageGuides'
import { TestScreen } from './TestScreen'
import { VisionRetryButton } from './VisionRetryButton'
import { pick, useLocale } from '../../lib/i18n'

/**
 * "Smile." Starts the face capture as soon as the screen appears: the framing gate holds it until the patient is
 * actually in shot, so there is nothing for them to press.
 */
export function FaceTest() {
  const locale = useLocale((s) => s.locale)
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
      title={retryPending || relaxing ? pick(locale, 'Serious face, lips closed', 'Cara seria, labios cerrados') : smiling ? pick(locale, 'Now smile big. Hold it.', 'Ahora sonr\u00ede ampliamente. Mant\u00e9nla.') : pick(locale, 'Look at the camera', 'Mira a la c\u00e1mara')}
      lede={
        retryPending
          ? pick(locale, 'Keep your lips gently closed with no smile. I will restart the check in a moment.', 'Mant\u00e9n los labios suavemente cerrados y no sonr\u00edas. La revisi\u00f3n se reiniciar\u00e1 en un momento.')
          : relaxing
            ? pick(locale, 'A serious, neutral expression, like a passport photo. Take your time; the smile comes next.', 'Una expresi\u00f3n seria y neutra, como en una foto de pasaporte. Despu\u00e9s te pediremos sonre\u00edr.')
            : smiling
              ? pick(locale, 'As wide as you comfortably can, and keep it there.', 'Tan amplia como puedas c\u00f3modamente, y mantenla.')
              : pick(locale, 'Fit your face inside the outline. First a serious, neutral face, then I will ask you to smile.', 'Coloca tu cara dentro del contorno. Primero una expresi\u00f3n seria y neutra; despu\u00e9s te pediremos sonre\u00edr.')
      }
      footer={<VisionRetryButton test="face" run={testRunner.runFace} />}
    >
      <CameraView guide={<HeadGuide tone={progress?.framingOk ? 'ok' : 'waiting'} />} />
    </TestScreen>
  )
}
