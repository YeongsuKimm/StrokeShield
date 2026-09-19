import { useEffect } from 'react'
import { useSession } from '../../lib/session/store'
import { useCaptureProgress } from '../../lib/vision/progressStore'
import { testRunner } from '../../lib/vision/useTestRunner'
import { CameraView } from '../CameraView'
import { Icon } from '../ui/Icon'
import { MicroLabel } from '../ui/Primitives'
import { ArmPoseFigure, BodyGuide } from './StageGuides'
import { TestScreen } from './TestScreen'

/** The one screen where the patient has to move: back about two metres, until both hands are in shot. */
export function ArmsTest() {
  const progress = useCaptureProgress((s) => s.progress)
  const running = useCaptureProgress((s) => s.running)

  useEffect(() => {
    void testRunner.runArms()
    return () => {
      if (useSession.getState().phase !== 'arms') testRunner.cancel()
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
      rail={
        <aside className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <MicroLabel className="col-span-2 lg:col-span-1">The pose</MicroLabel>
          {(['front', 'angle'] as const).map((view) => (
            <figure key={view} className="overflow-hidden rounded-[var(--radius-control)]">
              <ArmPoseFigure view={view} />
              <figcaption className="mt-1.5 text-[0.875rem] leading-snug text-ink-3">
                {view === 'front' ? 'Arms level with your shoulders.' : 'Palms up, elbows straight.'}
              </figcaption>
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
