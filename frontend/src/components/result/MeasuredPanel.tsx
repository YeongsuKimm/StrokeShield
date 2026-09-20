import { testSequence } from '../../lib/config'
import { MEASURED_COPY } from '../../lib/copy/features'
import { measuredChecks } from '../../lib/measured'
import { useSession } from '../../lib/session/store'
import { smartQuotes } from '../../lib/typography'
import { pick, useLocale } from '../../lib/i18n'

/**
 * "The numbers behind each check", collapsed until asked for. Words and numbers only: no video, no replay, nothing
 * stored (it reads the in-memory results, which "Clear my data" wipes). Each measured check says it is a
 * measurement, not a diagnosis; skipped or unclear checks say "Not measured".
 */
export function MeasuredPanel() {
  const locale = useLocale((s) => s.locale)
  const results = useSession((s) => s.results)
  const skipped = useSession((s) => s.skipped)
  const checks = measuredChecks(results, skipped, testSequence())

  return (
    <details className="mb-4 rounded-[var(--radius-control)] border border-line bg-surface">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 text-[0.9375rem] font-medium text-ink-2">{pick(locale, MEASURED_COPY.summary, 'Las cifras de cada revisi\u00f3n')}</summary>
      <div className="border-t border-line px-4 py-4">
        <p className="max-w-[60ch] text-[0.875rem] leading-snug text-ink-3">{pick(locale, smartQuotes(MEASURED_COPY.intro), 'Estas cifras vienen de la c\u00e1mara y el micr\u00f3fono durante las revisiones. Izquierda y derecha son las de la persona. Nada se almacena. Las etiquetas t\u00e9cnicas aparecen en ingl\u00e9s.')}</p>
        <ul className="mt-3 divide-y divide-line">
          {checks.map((c) => (
            <li key={c.test} className="py-3 first:pt-0 last:pb-0">
              <h3 className="text-[0.9375rem] font-semibold tracking-tight">{c.name}</h3>
              {c.status === 'measured' ? (
                <>
                  <p className="text-[0.8125rem] text-ink-3">{pick(locale, MEASURED_COPY.note, 'Una medici\u00f3n, no un diagn\u00f3stico.')}</p>
                  <dl className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 text-[0.875rem] sm:max-w-md">
                    {c.rows.map((r) => (
                      <div key={r.label} className="col-span-2 grid grid-cols-subgrid">
                        <dt className="text-ink-3">{r.label}</dt>
                        <dd className="tnum text-right text-ink-2">{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : (
                <p className="text-[0.875rem] text-ink-3">
                  {pick(locale, `${MEASURED_COPY.notMeasured} ${c.reason}`, 'No se pudo medir esta revisi\u00f3n.')}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}
