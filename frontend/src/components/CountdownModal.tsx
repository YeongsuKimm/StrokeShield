import { useEffect, useState } from 'react'
import { COUNTDOWN_SECONDS, USER_REQUEST_COUNTDOWN_SECONDS } from '../lib/config'
import { countdownAnnouncement } from '../lib/a11y/announce'
import { useSession } from '../lib/session/store'
import { AlertPreview } from './result/AlertPreview'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'
import { Ring } from './ui/Primitives'

/**
 * The cancelable countdown before an alert goes out (docs/spec/05). Full-screen and unmistakable: the patient may
 * be impaired, and cancelling has to be the easiest thing on screen.
 *
 * The alert never dials emergency services — the backend only ever contacts DEMO_PHONE_NUMBER. The copy says
 * "demo contact" rather than "911" so the demo never overstates what it does.
 */
export function CountdownModal() {
  const alertReason = useSession((s) => s.alertReason)
  const agentConnected = useSession((s) => s.agentConnected)
  const cancelCountdown = useSession((s) => s.cancelCountdown)
  const confirmCountdown = useSession((s) => s.confirmCountdown)
  const total = alertReason === 'user_request' ? USER_REQUEST_COUNTDOWN_SECONDS : COUNTDOWN_SECONDS
  const [left, setLeft] = useState(total)

  useEffect(() => {
    if (left <= 0) {
      confirmCountdown()
      return
    }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000)
    return () => clearTimeout(id)
  }, [left, confirmCountdown])

  // Focus starts on Cancel (the safe, first control): Enter or Space cancels at once. The rest of the page is inert.
  useEffect(() => {
    document.getElementById('countdown-cancel')?.focus()
  }, [])

  // Cancel is the default target: Escape does the same thing as the button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancelCountdown()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [cancelCountdown])

  return (
    <div
      className="fixed inset-0 z-50 flex overflow-y-auto bg-ink/80 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="countdown-title"
      aria-describedby="countdown-body"
    >
      <div className="m-auto w-full max-w-lg rounded-[var(--radius-panel)] bg-surface p-8 text-center shadow-[var(--shadow-lift)] sm:p-12">
        <p className="label-micro flex items-center justify-center gap-2 text-danger">
          <Icon name="alert" size={15} />
          {alertReason === 'user_request' ? 'You asked for help' : 'Checks suggest urgent attention'}
        </p>

        <h2 id="countdown-title" className="mt-4 text-balance text-3xl font-semibold leading-tight tracking-tight">
          Texting the demo contact
        </h2>

        {/* Sparse spoken countdown (start, every 5 s, last 3 s): the ring below is decorative and never read out. */}
        <p role="status" className="sr-only">
          {countdownAnnouncement(left, total)}
        </p>

        <div className="my-8 flex justify-center text-danger">
          <Ring
            fraction={left / total}
            label={String(left)}
            size={168}
            stroke={10}
            tone="var(--color-danger)"
            track="var(--color-sunken)"
          />
        </div>

        <p id="countdown-body" className="mx-auto max-w-[38ch] text-lg text-ink-2">
          A text message with your location is about to go out.{' '}
          {agentConnected ? 'Say “cancel”, or press the button.' : 'Press the button to cancel.'}
        </p>

        <Button id="countdown-cancel" size="xl" tone="neutral" block className="mt-8" onClick={cancelCountdown}>
          Cancel the text
        </Button>

        <a href="tel:911" className="mt-4 inline-flex items-center gap-2 font-medium text-danger underline underline-offset-4">
          <Icon name="phone" size={16} />
          Or call 911 yourself, right now
        </a>

        {/* Below Cancel and 911 on purpose: a courtesy that never moves them, and never delays the countdown. */}
        <AlertPreview stage="before" className="mt-6" />
      </div>
    </div>
  )
}
