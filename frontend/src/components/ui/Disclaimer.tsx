import { DISCLAIMER_LONG, DISCLAIMER_LONG_ES, DISCLAIMER_SHORT, DISCLAIMER_SHORT_ES } from '../../lib/disclaimer'
import { pick, useLocale } from '../../lib/i18n'

/** The shared disclaimer line. Text always comes from lib/disclaimer.ts; pass `className` for placement/colour only. */
export function Disclaimer({ variant = 'long', className = '' }: { variant?: 'short' | 'long'; className?: string }) {
  const locale = useLocale((s) => s.locale)
  return (
    <p role="note" className={className}>
      {variant === 'short' ? pick(locale, DISCLAIMER_SHORT, DISCLAIMER_SHORT_ES) : pick(locale, DISCLAIMER_LONG, DISCLAIMER_LONG_ES)}
    </p>
  )
}
