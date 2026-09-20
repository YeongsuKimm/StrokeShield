import { useEffect, useRef, useState } from 'react'
import { testSequence, type ResultBand } from '../../lib/config'
import { SUMMARY_COPY } from '../../lib/copy/features'
import { copyToClipboard } from '../../lib/copyToClipboard'
import { useSession } from '../../lib/session/store'
import { buildSummary } from '../../lib/summary'
import { Button } from '../ui/Button'
import { pick, useLocale } from '../../lib/i18n'

const COPIED_FOR_MS = 4000

/**
 * "Copy summary": a plain-text note (checks, flags, result wording, disclaimer, 911 line) for a family member or a
 * paramedic. Rendered as fragment children of the action row so it sits beside the other quiet buttons. Nothing is
 * stored or sent; the text is built on click, goes to the clipboard, and is kept in memory only if the clipboard
 * refused (then it is shown selected in a text area so it can be copied by hand).
 */
export function CopySummary({ band }: { band: ResultBand }) {
  const locale = useLocale((s) => s.locale)
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [manual, setManual] = useState('')
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const copy = async () => {
    const st = useSession.getState()
    const text = buildSummary({ now: new Date(), band, order: testSequence(), results: st.results, skipped: st.skipped, lastKnownWell: st.lastKnownWell })
    const outcome = await copyToClipboard(text)
    setManual(outcome === 'failed' ? text : '')
    setState(outcome)
  }

  useEffect(() => {
    if (state === 'copied') {
      const id = setTimeout(() => setState('idle'), COPIED_FOR_MS)
      return () => clearTimeout(id)
    }
    if (state === 'failed') areaRef.current?.select()
  }, [state])

  return (
    <>
      <Button tone="quiet" onClick={() => void copy()}>
        {state === 'copied' ? pick(locale, SUMMARY_COPY.copied, 'Resumen copiado') : pick(locale, SUMMARY_COPY.button, 'Copiar resumen en ingl\u00e9s')}
      </Button>
      {/* Polite, always mounted so screen readers pick up the change; the button label shows it for everyone else. */}
      <p role="status" className="sr-only">
        {state === 'copied' ? pick(locale, SUMMARY_COPY.copied, 'Resumen copiado') : state === 'failed' ? pick(locale, SUMMARY_COPY.failed, 'No se pudo copiar autom\u00e1ticamente. Selecciona el texto de abajo y c\u00f3pialo.') : ''}
      </p>
      {state === 'failed' && manual && (
        <div className="basis-full">
          <p className="text-[0.875rem] text-ink-3">{pick(locale, SUMMARY_COPY.failed, 'No se pudo copiar autom\u00e1ticamente. Selecciona el texto de abajo y c\u00f3pialo.')}</p>
          <textarea
            ref={areaRef}
            readOnly
            rows={9}
            value={manual}
            aria-label={pick(locale, SUMMARY_COPY.manualLabel, 'Resumen para copiar')}
            className="mt-2 w-full rounded-[var(--radius-control)] border border-line bg-surface p-3 text-[0.875rem] leading-snug text-ink-2"
          />
        </div>
      )}
    </>
  )
}
