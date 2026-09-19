// Screen-reader announcement helpers. Pure (no DOM, no React): components feed them values and render the result
// into an sr-only aria-live region, so a fast-changing signal never turns into a stream of speech.

/**
 * Text for the countdown before an alert goes out, or null when this second should stay silent.
 * The dialog itself is announced when it opens (title + description), so this only speaks at the start,
 * every 5 seconds, and at 3, 2 and 1 (the last moments to cancel matter most).
 */
export function countdownAnnouncement(left: number, total: number): string | null {
  if (left <= 0) return null
  const say = left === total || left % 5 === 0 || left <= 3
  if (!say) return null
  return left === 1 ? 'Sending in 1 second.' : `Sending in ${left} seconds.`
}

/**
 * Text for a timed capture (relax / smile / hold): the seconds left only on 5 second marks, optionally after a caption.
 * Between the marks it returns just the caption (or nothing), so the live region's text does not change and nothing is
 * re-read every tick.
 */
export function captureAnnouncement(caption: string, secondsLeft: number | null): string {
  const mark = secondsLeft !== null && secondsLeft > 0 && secondsLeft % 5 === 0 ? `${secondsLeft} seconds left.` : ''
  if (!mark) return caption
  return caption ? `${caption}. ${mark}` : mark
}

export interface Announcer {
  /** Offer the newest message. Emitted at once if the last one was >= minGapMs ago, else after the gap (latest wins). */
  push(text: string): void
  cancel(): void
}

/**
 * Rate-limits what a live region says: at most one change per `minGapMs`, always ending on the latest text, and
 * identical repeats are dropped. The clock and timers are injectable so this is testable without a DOM.
 */
export function createAnnouncer(
  emit: (text: string) => void,
  minGapMs = 3000,
  now: () => number = Date.now,
  setT: (fn: () => void, ms: number) => unknown = setTimeout,
  clearT: (id: unknown) => void = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
): Announcer {
  let lastEmitted: string | null = null
  let lastAt = -Infinity
  let pending: string | null = null
  let timer: unknown = null

  const flush = () => {
    timer = null
    if (pending === null) return
    const text = pending
    pending = null
    if (text === lastEmitted) return
    lastEmitted = text
    lastAt = now()
    emit(text)
  }

  return {
    push(text) {
      if (text === lastEmitted && pending === null) return
      pending = text
      if (timer !== null) return // already waiting; the timer will send the newest text
      const wait = lastAt + minGapMs - now()
      if (wait <= 0) flush()
      else timer = setT(flush, wait)
    },
    cancel() {
      if (timer !== null) clearT(timer)
      timer = null
      pending = null
    },
  }
}
