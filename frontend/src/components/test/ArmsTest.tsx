import { useEffect, useState } from 'react'
import { currentBrowser } from '../../lib/preflight/browserSupport'
import { useCaptureProgress } from '../../lib/vision/progressStore'
import { isVisionScreenActive, runVisionWithOneRetry } from '../../lib/vision/retry'
import { testRunner } from '../../lib/vision/useTestRunner'
import { CameraView } from '../CameraView'
import { Icon } from '../ui/Icon'
import { MicroLabel } from '../ui/Primitives'
import { BodyGuide } from './StageGuides'
import { TestScreen } from './TestScreen'
import { VisionRetryButton } from './VisionRetryButton'
import { pick, useLocale } from '../../lib/i18n'

/** The two position-guiding pictures shown beside the camera. */
const POSES = [
  { src: '/images/arms-stand.jpg', alt: 'A figure with both arms held out to the sides, elbows bent', caption: 'Arms out to your sides' },
  { src: '/images/arms-raise.jpg', alt: 'The same figure with both arms raised', caption: 'Then raise both arms' },
] as const

/**
 * The one screen where the patient has to move: back until their whole arm span is in shot.
 *
 * No distance is quoted any more. How far back "far enough" is depends entirely on the camera's field of view, and a
 * phone held in portrait sees a much narrower slice than a laptop: the same three feet that works on a laptop leaves
 * both hands out of frame on a phone. The framing gate already measures the real thing, frame by frame, so the
 * instruction is simply to keep stepping back until it is satisfied.
 */
export function ArmsTest() {
  const locale = useLocale((s) => s.locale)
  // Read once: the device does not change mid-check, and this only picks which hints to show.
  const [onPhone] = useState(() => currentBrowser().ios || currentBrowser().android)
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
      title={inPosition ? pick(locale, 'Hold both arms out', 'Mant\u00e9n ambos brazos extendidos') : pick(locale, 'Step back until both hands fit', 'Retrocede hasta que ambas manos entren en la imagen')}
      lede={
        inPosition
          ? pick(locale, 'Straight out to your sides, palms turned up. Hold still for ten seconds while I watch.', 'Exti\u00e9ndelos a los lados con las palmas hacia arriba. Mantente quieto durante diez segundos.')
          : pick(locale, 'Keep going until your whole upper body and both hands fit inside the outline.', 'Sigue retrocediendo hasta que la parte superior de tu cuerpo y ambas manos entren en el contorno.')
      }
      footer={<VisionRetryButton test="arms" run={testRunner.runArms} />}
      rail={
        <aside className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <MicroLabel className="col-span-2 lg:col-span-1">{pick(locale, 'The pose', 'La postura')}</MicroLabel>
          {POSES.map((pose) => (
            <figure key={pose.src} className="overflow-hidden rounded-[var(--radius-control)] border border-line bg-white">
              <img src={pose.src} alt={pick(locale, pose.alt, pose.src.includes('stand') ? 'Una persona con ambos brazos extendidos a los lados' : 'La misma persona con ambos brazos levantados')} width={320} height={320} loading="eager" className="block aspect-square w-full object-contain" />
              <figcaption className="border-t border-line px-3 py-2 text-[0.9375rem] font-medium leading-snug text-ink-2">{pick(locale, pose.caption, pose.src.includes('stand') ? 'Brazos extendidos a los lados' : 'Luego levanta ambos brazos')}</figcaption>
            </figure>
          ))}
          {/* Only worth saying on a phone: at arm-span distance the patient cannot also be holding the device. */}
          {onPhone && (
            <p className="col-span-2 flex items-start gap-2 text-[0.875rem] leading-snug text-ink-3 lg:col-span-1">
              <Icon name="pin" size={14} className="mt-px shrink-0" />
              {pick(locale, 'Stand your phone up first, screen towards you, at about chest height.', 'Coloca primero el tel\u00e9fono en vertical, con la pantalla hacia ti y aproximadamente a la altura del pecho.')}
            </p>
          )}
          <p className="col-span-2 flex items-start gap-2 text-[0.875rem] leading-snug text-ink-3 lg:col-span-1">
            <Icon name="pin" size={14} className="mt-px shrink-0" />
            {pick(locale, 'Keep stepping back until the outline turns green. Camera lenses vary, so use the on-screen guide.', 'Sigue retrocediendo hasta que el contorno se vuelva verde. Como las cámaras varían, usa la guía en pantalla.')}
          </p>
        </aside>
      }
    >
      <CameraView guide={<BodyGuide tone={progress?.framingOk ? 'ok' : 'waiting'} />} />
    </TestScreen>
  )
}
