import { useEffect, useState } from 'react'
import { COUNTDOWN_SECONDS, USER_REQUEST_COUNTDOWN_SECONDS } from '../lib/config'
import { useSession } from '../lib/session/store'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'
import { Ring } from './ui/Primitives'

/**
 * The cancelable countdown before an alert goes out (docs/spec/05). Full-screen and unmistakable: the patient may
 * be impaired, and cancelling has to be the easiest thing on screen.
 *
 * The alert never dials emergency services — the backend only ever contacts DEMO_PHONE_NUMBER. The copy says
 * "emergency contact" rather than "911" so the demo never overstates what it does.
 */
export function CountdownModal() {
  const alertReason = useSession((s) => s.alertReason)
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

  // Cancel is the default target: Escape does the same thing as the button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancelCountdown()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [cancelCountdown])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="countdown-title"
    >
      <div className="w-full max-w-lg rounded-[var(--radius-panel)] bg-surface p-8 text-center shadow-[var(--shadow-lift)] sm:p-12">
        <p className="label-micro flex items-center justify-center gap-2 text-danger">
          <Icon name="alert" size={15} />
          {alertReason === 'user_request' ? 'You asked for help' : 'Checks suggest urgent attention'}
        </p>

        <h2 id="countdown-title" className="mt-4 text-balance text-3xl font-semibold leading-tight tracking-tight">
          Contacting your emergency contact
        </h2>

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

        <p className="mx-auto max-w-[38ch] text-lg text-ink-2">
          A text message with your location is about to go out. Say “cancel”, or press the button.
        </p>

        <Button autoFocus size="xl" tone="neutral" block className="mt-8" onClick={cancelCountdown}>
          Cancel — I am OK
        </Button>

        <a href="tel:911" className="mt-4 inline-flex items-center gap-2 font-medium text-danger underline underline-offset-4">
          <Icon name="phone" size={16} />
          Or call 911 yourself, right now
        </a>
      </div>
    </div>
  )
}
