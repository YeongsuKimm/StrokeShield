// Shared "keep scrolling to move to the other page" gesture, used in BOTH directions:
//   home -> info   (scroll DOWN past the bottom of the home page)
//   info -> home   (scroll UP past the top of the info page)
//
// The gesture COMMITS: once enough intent has built up, the caller's `onCross` runs and the page swaps outright.
// There is no half-scrolled resting state. Wheel, touch swipe and the arrow / Page / Home / End keys all count.
// It is deliberately a little stiff (a single flick does nothing) but never the only way through: every place that
// uses it also has an explicit button.
import { useEffect, useRef, useState } from 'react'

/** Wheel travel, in the direction of travel and near the page edge, that commits the hand-off. Going BACK to the
 *  check (up) asks for a little more than going on to the info page (down), so a stray upward scroll on the long
 *  info page is less likely to throw the reader out of it. */
export const HANDOFF_BUFFER_PX = { down: 143, up: 221 } as const
/**
 * Accumulated travel fades at this rate per 100 ms. Gentle on purpose: a plain mouse wheel delivers one ~100 px notch
 * at a time, maybe a second apart, and a faster fade would keep that from ever adding up to the buffer (it stalls
 * just short, which reads as the page hanging). At 0.97, two notches a second apart still commit; a lone flick,
 * or two flicks many seconds apart, still do not.
 */
const DECAY_PER_100MS = 0.97
/** A swipe of at least this many pixels counts as the same intent on a touch screen. */
const SWIPE_PX = { down: 117, up: 169 } as const
/**
 * Within this many pixels of the edge counts as "at the edge". A window a few dozen pixels too short for its
 * content would otherwise swallow the first ticks of the gesture scrolling that sliver, which reads as hanging.
 */
const NEAR_EDGE_PX = 160
/** After a hand-off, ignore input for this long so trackpad inertia cannot immediately bounce back. */
const COOLDOWN_MS = 700

/** Shared across every hook instance: the tail of one page's momentum must not trigger the next page's gesture. */
let lastCommitAt = 0

export type HandoffDirection = 'down' | 'up'

const atEdge = (dir: HandoffDirection): boolean =>
  dir === 'down'
    ? document.documentElement.scrollHeight - window.innerHeight - window.scrollY <= NEAR_EDGE_PX
    : window.scrollY <= NEAR_EDGE_PX

const KEYS: Record<HandoffDirection, string[]> = {
  down: ['ArrowDown', 'PageDown', 'End'],
  up: ['ArrowUp', 'PageUp', 'Home'],
}

/**
 * @returns progress toward the hand-off, 0..1, for a progress indicator.
 * `enabled` false detaches everything. `onCross` may change identity every render; it is read through a ref.
 */
export function useScrollHandoff(enabled: boolean, direction: HandoffDirection, onCross: () => void): number {
  const [progress, setProgress] = useState(0)
  const acc = useRef(0)
  const last = useRef(0)
  const touchStartY = useRef<number | null>(null)

  // The callback lives in a ref so the listeners below are attached ONCE per (enabled, direction). Depending on it
  // directly re-subscribed on every render (each setProgress re-renders and callers pass a fresh arrow), and the
  // cleanup wiped the accumulated travel every time, so the buffer could never fill.
  const onCrossRef = useRef(onCross)
  useEffect(() => {
    onCrossRef.current = onCross
  }, [onCross])

  useEffect(() => {
    if (!enabled) return
    const sign = direction === 'down' ? 1 : -1
    const inCooldown = () => performance.now() - lastCommitAt < COOLDOWN_MS

    const commit = () => {
      acc.current = 0
      setProgress(0)
      lastCommitAt = performance.now()
      onCrossRef.current()
    }

    const onWheel = (e: WheelEvent) => {
      const travel = e.deltaY * sign // positive = the direction that leads to the other page
      if (travel < 0) {
        acc.current = 0 // scrolling the other way cancels the intent
        setProgress(0)
        return
      }
      if (inCooldown() || !atEdge(direction)) return
      const now = performance.now()
      const idle = last.current ? now - last.current : 0
      last.current = now
      acc.current = acc.current * Math.pow(DECAY_PER_100MS, idle / 100) + travel
      if (acc.current >= HANDOFF_BUFFER_PX[direction]) commit()
      else setProgress(acc.current / HANDOFF_BUFFER_PX[direction])
    }

    const onTouchStart = (e: TouchEvent) => {
      touchStartY.current = e.touches[0]?.clientY ?? null
    }
    const onTouchMove = (e: TouchEvent) => {
      if (touchStartY.current === null || inCooldown() || !atEdge(direction)) return
      const y = e.touches[0]?.clientY ?? touchStartY.current
      // Finger moving UP scrolls the page DOWN, and vice versa.
      const dy = (touchStartY.current - y) * sign
      if (dy > 0) setProgress(Math.min(1, dy / SWIPE_PX[direction]))
      if (dy >= SWIPE_PX[direction]) {
        touchStartY.current = null
        commit()
      }
    }
    const onTouchEnd = () => {
      touchStartY.current = null
      setProgress(0)
    }

    const onKey = (e: KeyboardEvent) => {
      if (/^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test((e.target as HTMLElement)?.tagName)) return
      if (KEYS[direction].includes(e.key) && !inCooldown() && atEdge(direction)) commit()
    }

    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('keydown', onKey)
      acc.current = 0
    }
  }, [enabled, direction])

  return enabled ? Math.min(1, progress) : 0
}
