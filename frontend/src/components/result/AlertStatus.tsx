import { useEffect, useState } from 'react'
import { describeAlertFailure, formatWait, isDemoNothingSent } from '../../lib/alertFailure'
import { useSession } from '../../lib/session/store'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'

/** Seconds left until `deadline` (ms epoch), ticking once a second. */
function useSecondsUntil(deadline: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (deadline === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [deadline])
  return deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000))
}

/**
 * What actually happened on the alert path, said plainly: sending, sent, "demo mode: nothing was sent", or a failure
 * with its reason, Call 911 first, and ONE retry button (disabled while a server wait applies). Nothing here can
 * choose a destination; the backend only ever texts DEMO_PHONE_NUMBER.
 */
export function AlertStatus() {
  const alertStatus = useSession((s) => s.alertStatus)
  const alertResponse = useSession((s) => s.alertResponse)
  const retryAlert = useSession((s) => s.retryAlert)
  const failure = alertStatus === 'failed' ? describeAlertFailure(alertResponse) : null
  const alertResultAt = useSession((s) => s.alertResultAt)
  const deadline = failure && failure.retryAfterS > 0 && alertResultAt ? alertResultAt + failure.retryAfterS * 1000 : null
  const wait = useSecondsUntil(deadline)

  if (alertStatus === 'none') return null

  if (failure) {
    return (
      <div className="mt-4 rounded-[var(--radius-control)] border-2 border-danger bg-surface px-5 py-5" role="alert">
        <p className="flex items-center gap-2 text-lg font-semibold text-danger">
          <Icon name="alert" size={20} />
          The text did not go through: {failure.title}
        </p>
        <p className="mt-2 text-[1rem] text-ink-2">{failure.detail}</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Button as="a" href="tel:911" tone="danger" size="xl" icon="phone" className="sm:flex-1">
            Call 911 now
          </Button>
          <Button tone="quiet" size="lg" icon="refresh" disabled={wait > 0} onClick={() => retryAlert()}>
            {wait > 0 ? `Send again in ${formatWait(wait)}` : 'Try sending again'}
          </Button>
        </div>
      </div>
    )
  }

  const nothingSent = isDemoNothingSent(alertResponse)
  return (
    <div
      className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-control)] border border-line bg-surface px-5 py-4"
      role="status"
    >
      <Icon
        name={alertStatus === 'sent' && !nothingSent ? 'check' : 'clock'}
        size={18}
        className={alertStatus === 'sent' && !nothingSent ? 'text-ok' : 'text-ink-3'}
      />
      <p className="font-medium">
        {alertStatus === 'sending' && 'Contacting the demo number…'}
        {alertStatus === 'sent' && !nothingSent && 'Alert sent to the demo number.'}
        {nothingSent && 'Demo mode: nothing was sent.'}
      </p>
      {nothingSent && (
        <span className="text-[0.9375rem] text-ink-2">
          The server is in dry-run mode and only logged the alert. No text message went out, so call 911 yourself if this is real.
        </span>
      )}
    </div>
  )
}
