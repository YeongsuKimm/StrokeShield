import { useEffect, useRef, useState } from 'react'
import { EYE_PROTOCOL, EYE_PROTOCOL_TOTAL_MS, type EyeTarget } from '../lib/vision/eyeProtocol'

interface Props {
  /**
   * Fires at protocol start (center) and whenever the dot is commanded to a new side. `target` is the PATIENT's own
   * left/right. `tMs` is `performance.now()` at that moment (same clock as rAF / video-frame timestamps), so frames
   * can be labelled by comparing their timestamp against it.
   */
  onTargetChange: (target: EyeTarget, tMs: number) => void
  onDone: () => void
  /**
   * Set only when this component is rendered inside a CSS-mirrored (scaleX(-1)) container. The patient faces the
   * screen, so patient-left is physically screen-left; a mirrored ancestor would flip that, so we swap the CSS side.
   */
  mirrored?: boolean
  /**
   * Show the instruction line under the dot. Default on. The eyes screen turns it off because the caption bar at the
   * bottom of the camera says the same thing, and two text boxes over a phone-sized camera is one too many.
   */
  showCaption?: boolean
}

// Horizontal dot position as a percentage of the width (in the patient's own left/right frame).
const POS_PCT: Record<EyeTarget, number> = { left: 10, center: 50, right: 90 }

export function EyeStimulus({ onTargetChange, onDone, mirrored = false, showCaption = true }: Props) {
  const [target, setTarget] = useState<EyeTarget>('center')
  const cbs = useRef({ onTargetChange, onDone })
  useEffect(() => {
    cbs.current = { onTargetChange, onDone }
  })

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    let at = 0
    for (const step of EYE_PROTOCOL) {
      timers.push(
        setTimeout(() => {
          setTarget(step.target)
          cbs.current.onTargetChange(step.target, performance.now())
        }, at),
      )
      at += step.ms
    }
    timers.push(setTimeout(() => cbs.current.onDone(), EYE_PROTOCOL_TOTAL_MS))
    return () => timers.forEach(clearTimeout)
  }, [])

  const pct = mirrored ? 100 - POS_PCT[target] : POS_PCT[target]

  return (
    <div className="relative h-64 w-full overflow-hidden rounded-2xl bg-black/40">
      {/* The dot is purely visual (aria-hidden); the caption below (or the camera's caption bar, when this one is off) and the screen heading give the same instruction as text. */}
      <div
        aria-hidden
        className="absolute top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-black bg-yellow-300 shadow-[0_0_24px_8px_rgba(253,224,71,0.6)] transition-[left] duration-500 ease-in-out"
        // Clamped so the whole dot stays inside the box. At 10% / 90% of a phone-width box (about 280 px) the 80 px dot
        // used to be cut off at the edge. On a laptop 10% is already well clear of the edge, so nothing changes there.
        style={{ left: `clamp(2.75rem, ${pct}%, calc(100% - 2.75rem))` }}
      />
      {showCaption && (
        <p className="absolute inset-x-0 bottom-3 text-center text-sm font-medium text-white">
          Keep your head still. Follow the dot with your eyes only.
        </p>
      )}
    </div>
  )
}
