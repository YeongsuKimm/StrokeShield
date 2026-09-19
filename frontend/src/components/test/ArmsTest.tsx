import { useEffect } from 'react'
import { useCaptureProgress } from '../../lib/vision/progressStore'
import { isVisionScreenActive, runVisionWithOneRetry } from '../../lib/vision/retry'
import { testRunner } from '../../lib/vision/useTestRunner'
import { CameraView } from '../CameraView'
import { Icon } from '../ui/Icon'
import { MicroLabel } from '../ui/Primitives'
import { BodyGuide } from './StageGuides'
import { TestScreen } from './TestScreen'
import { VisionRetryButton } from './VisionRetryButton'

/** The two position-guiding pictures shown beside the camera. */
const POSES = [
  { src: '/images/arms-stand.jpg', alt: 'A figure standing tall with arms relaxed at the sides', caption: 'Stand tall, arms relaxed' },
  { src: '/images/arms-raise.jpg', alt: 'The same figure with both arms raised', caption: 'Then raise both arms' },
] as const

/** The one screen where the patient has to move: back about two metres, until both hands are in shot. */
export function ArmsTest() {
  const progress = useCaptureProgress((s) => s.progress)
  const running = useCaptureProgress((s) => s.running)

  useEffect(() => {
    void runVisionWithOneRetry(testRunner.runArms, () => isVisionScreenActive('arms'))
    return () => {
      if (!isVisionScreenActive('arms')) testRunner.cancel()
    }
  }, [])

  const inPosition = running === 'arms' && progress?.phase !== 'waiting'

  return (
    <TestScreen
      test="arms"
      title={inPosition ? 'Hold both arms out' : 'Step back, about six feet'}
      lede={
        inPosition
          ? 'Straight out to your sides, palms turned up. Hold still — I am watching for ten seconds.'
          : 'Keep going until your whole upper body and both hands fit inside the outline.'
      }
      footer={<VisionRetryButton test="arms" run={testRunner.runArms} />}
      rail={
        <aside className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <MicroLabel className="col-span-2 lg:col-span-1">The pose</MicroLabel>
          {POSES.map((pose) => (
            <figure key={pose.src} className="overflow-hidden rounded-[var(--radius-control)] border border-line bg-white">
              <img src={pose.src} alt={pose.alt} width={320} height={320} loading="eager" className="block aspect-square w-full object-contain" />
              <figcaption className="border-t border-line px-3 py-2 text-[0.9375rem] font-medium leading-snug text-ink-2">{pose.caption}</figcaption>
            </figure>
          ))}
          <p className="col-span-2 flex items-start gap-2 text-[0.875rem] leading-snug text-ink-3 lg:col-span-1">
            <Icon name="pin" size={14} className="mt-px shrink-0" />
            Clear about two and a half metres behind you before you start.
          </p>
        </aside>
      }
    >
      <CameraView guide={<BodyGuide tone={progress?.framingOk ? 'ok' : 'waiting'} />} />
    </TestScreen>
  )
}
