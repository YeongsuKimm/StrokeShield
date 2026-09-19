// React glue for the pure helpers in this folder: focus management on screen changes, and a throttled live region.
import { useEffect, useRef, useState, type RefObject } from 'react'
import { createAnnouncer } from './announce'

/** Flipped once the app's first paint is done, so the very first screen does not steal focus from the address bar. */
let appReady = false
export function markAppReady() {
  setTimeout(() => {
    appReady = true
  }, 0)
}

/**
 * Moves keyboard/screen-reader focus to the screen's heading when the screen appears (after the first load), so the
 * new screen is announced and the next Tab starts at its top. The heading needs tabIndex={-1}.
 * Pass a changing `trigger` to re-focus when the same screen changes state (e.g. the result screen after the countdown closes).
 */
export function useFocusHeading(ref: RefObject<HTMLElement | null>, trigger: unknown = null, enabled = true) {
  useEffect(() => {
    if (!appReady || !enabled) return
    // Focus without scrolling: the page was already scrolled to the top by the route transition.
    ref.current?.focus({ preventScroll: true })
  }, [ref, trigger, enabled])
}

/** Returns text that follows `text` but changes at most once per `minGapMs`; render it inside an sr-only aria-live region. */
export function useThrottledAnnouncement(text: string, minGapMs = 3000): string {
  const [said, setSaid] = useState('')
  const announcer = useRef<ReturnType<typeof createAnnouncer> | null>(null)
  useEffect(() => {
    announcer.current = createAnnouncer(setSaid, minGapMs)
    return () => announcer.current?.cancel()
  }, [minGapMs])
  useEffect(() => {
    announcer.current?.push(text)
  }, [text])
  return said
}
