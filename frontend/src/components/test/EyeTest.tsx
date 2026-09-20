import { useEffect } from 'react'
import { useCaptureProgress } from '../../lib/vision/progressStore'
import { isVisionScreenActive, runVisionWithOneRetry } from '../../lib/vision/retry'
import { testRunner } from '../../lib/vision/useTestRunner'
import { CameraView } from '../CameraView'
import { EyeStimulus } from '../EyeStimulus'
import { HeadGuide } from './StageGuides'
import { TestScreen } from './TestScreen'
import { VisionRetryButton } from './VisionRetryButton'
import { pick, useLocale } from '../../lib/i18n'

/**
 * "Follow the dot." BE-FAST stretch, behind FEATURES.eyesTest.
 *
 * The dot is rendered over the camera stage but OUTSIDE the mirrored layer, so `mirrored` stays false: the patient
 * faces the screen, which makes their own left the screen's left. The stimulus mounts exactly when the capture
 * window opens (progress.phase === 'hold'), which is what lets the analyzer label frames by dot position.
 */
export function EyeTest() {
  const locale = useLocale((s) => s.locale)
  const progress = useCaptureProgress((s) => s.progress)
  const running = useCaptureProgress((s) => s.running)

  useEffect(() => {
    void runVisionWithOneRetry(testRunner.runEyes, () => isVisionScreenActive('eyes'))
    return () => {
      if (!isVisionScreenActive('eyes')) testRunner.cancel()
    }
  }, [])

  const tracking = running === 'eyes' && progress?.phase === 'hold'

  return (
    <TestScreen
      test="eyes"
      title={tracking ? pick(locale, 'Follow the dot', 'Sigue el punto') : pick(locale, 'Keep your head still', 'Mant\u00e9n la cabeza quieta')}
      lede={pick(locale, 'Move only your eyes and keep your head where it is. The dot travels left, then right.', 'Mueve solo los ojos y mant\u00e9n la cabeza en su sitio. El punto ir\u00e1 a la izquierda y luego a la derecha.')}
      footer={<VisionRetryButton test="eyes" run={testRunner.runEyes} skippable />}
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
