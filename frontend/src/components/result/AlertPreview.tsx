import { useEffect, useMemo, useState } from 'react'
import { deliveryMode, previewMessage, type DeliveryMode } from '../../lib/alertPreview'
import { api } from '../../lib/api'
import { PREVIEW_COPY } from '../../lib/copy/features'
import { useSession } from '../../lib/session/store'
import { pick, useLocale } from '../../lib/i18n'

/** Dry-run or live, asked of /api/health in the background. Never blocks anything; unknown on any failure. */
function useHealthMode(enabled: boolean): DeliveryMode {
  const [mode, setMode] = useState<DeliveryMode>('unknown')
  useEffect(() => {
    if (!enabled) return
    let current = true
    api
      .health()
      .then((h) => current && setMode(deliveryMode(h)))
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [enabled])
  return mode
}

/**
 * The exact text message the demo phone receives (a mirror of the backend builder, see lib/alertPreview.ts), so the
 * patient can read it before it goes out and after. Quiet on purpose: a hairline box under the real actions.
 * `before` is the countdown; `sent` and `failed` are the result screen. It renders nothing if the text cannot be built.
 */
export function AlertPreview({ stage, className = '' }: { stage: 'before' | 'sent' | 'failed' | 'demoSent'; className?: string }) {
  const locale = useLocale((s) => s.locale)
  const session = useSession()
  const text = useMemo(() => (stage === 'before' ? previewMessage(session) : (session.sentText ?? previewMessage(session))), [stage, session])
  const mode = useHealthMode(stage === 'before')
  if (!text) return null

  const note = stage === 'before' ? (mode === 'demo' ? PREVIEW_COPY.demoBefore : mode === 'live' ? PREVIEW_COPY.live : null) : stage === 'sent' ? PREVIEW_COPY.live : null

  return (
    <div className={`rounded-[var(--radius-control)] border border-line px-4 py-3 text-left ${className}`}>
      <p className="text-[0.8125rem] font-medium text-ink-3">{pick(locale, PREVIEW_COPY[stage], ({ before: 'Este es el mensaje que se enviar\u00e1', sent: 'Este es el mensaje que se envi\u00f3', failed: 'Este es el mensaje que no se pudo enviar', demoSent: 'Este es el mensaje que enviar\u00eda una alerta real' } as const)[stage])}</p>
      <p className="mt-1 text-[0.9375rem] leading-snug text-ink-2 [overflow-wrap:anywhere]">{text}</p>
      {locale === 'es' && <p className="mt-1 text-[0.8125rem] text-ink-3">El mensaje al contacto de demo se envía en inglés.</p>}
      {note && <p className="mt-1 text-[0.8125rem] text-ink-3">{pick(locale, note, mode === 'demo' || stage === 'demoSent' ? 'Modo demo: no se envi\u00f3 ning\u00fan mensaje.' : 'La entrega se realiza seg\u00fan disponibilidad.')}</p>}
    </div>
  )
}
