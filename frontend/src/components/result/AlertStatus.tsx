import { useEffect, useState } from 'react'
import { describeAlertFailure, formatWait, isDemoNothingSent } from '../../lib/alertFailure'
import { useSession } from '../../lib/session/store'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { pick, useLocale } from '../../lib/i18n'

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
  const locale = useLocale((s) => s.locale)
  const alertStatus = useSession((s) => s.alertStatus)
  const alertResponse = useSession((s) => s.alertResponse)
  const retryAlert = useSession((s) => s.retryAlert)
  const failure = alertStatus === 'failed' ? describeAlertFailure(alertResponse) : null
  const alertResultAt = useSession((s) => s.alertResultAt)
  const deadline = failure && failure.retryAfterS > 0 && alertResultAt ? alertResultAt + failure.retryAfterS * 1000 : null
  const wait = useSecondsUntil(deadline)

  if (alertStatus === 'none') return null

  if (failure) {
    const failureEs = ({
      network: 'No se envi\u00f3 ning\u00fan mensaje. Revisa la conexi\u00f3n a internet e int\u00e9ntalo de nuevo.',
      rate_limited: `El servidor est\u00e1 limitando los intentos. Espera ${failure.retryAfterS || 60} segundos y vuelve a intentarlo.`,
      server: 'No se confirm\u00f3 el env\u00edo. Int\u00e9ntalo de nuevo en un momento.',
      not_configured: 'No se puede enviar ning\u00fan mensaje desde este servidor. Llama al 911.',
      refused: 'El servidor rechaz\u00f3 el mensaje. Usa el bot\u00f3n para solicitar ayuda directamente.',
      delivery: 'No se confirm\u00f3 el env\u00edo del mensaje.',
    } as const)[failure.category]
    return (
      <div className="mt-4 rounded-[var(--radius-control)] border-2 border-danger bg-surface px-5 py-5" role="alert">
        <p className="flex items-center gap-2 text-lg font-semibold text-danger">
          <Icon name="alert" size={20} />
          {pick(locale, `The text did not go through: ${failure.title}`, 'El mensaje no se pudo enviar.')}
        </p>
        <p className="mt-2 text-[1rem] text-ink-2">{pick(locale, failure.detail, failureEs)}</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Button as="a" href="tel:911" tone="danger" size="xl" icon="phone" className="sm:flex-1">
            {pick(locale, 'Call 911 now', 'Llama al 911 ahora')}
          </Button>
          <Button tone="quiet" size="lg" icon="refresh" disabled={wait > 0} onClick={() => retryAlert()}>
            {wait > 0 ? pick(locale, `Send again in ${formatWait(wait)}`, `Volver a enviar en ${formatWait(wait)}`) : pick(locale, 'Try sending again', 'Intentar enviar de nuevo')}
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
        {alertStatus === 'sending' && pick(locale, 'Contacting the demo number\u2026', 'Contactando al n\u00famero de demo\u2026')}
        {alertStatus === 'sent' && !nothingSent && pick(locale, 'Alert sent to the demo number.', 'Alerta enviada al n\u00famero de demo.')}
        {nothingSent && pick(locale, 'Demo mode: nothing was sent.', 'Modo demo: no se envi\u00f3 nada.')}
      </p>
      {nothingSent && (
        <span className="text-[0.9375rem] text-ink-2">
          {pick(locale, 'The server is in dry-run mode and only logged the alert. No text message went out, so call 911 yourself if this is real.', 'El servidor est\u00e1 en modo de prueba y solo registr\u00f3 la alerta. No sali\u00f3 ning\u00fan mensaje; llama al 911 si esto es real.')}
        </span>
      )}
    </div>
  )
}
