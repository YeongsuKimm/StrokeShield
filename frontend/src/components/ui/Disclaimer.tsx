import { DISCLAIMER_LONG, DISCLAIMER_SHORT } from '../../lib/disclaimer'

/** The shared disclaimer line. Text always comes from lib/disclaimer.ts; pass `className` for placement/colour only. */
export function Disclaimer({ variant = 'long', className = '' }: { variant?: 'short' | 'long'; className?: string }) {
  return (
    <p role="note" className={className}>
      {variant === 'short' ? DISCLAIMER_SHORT : DISCLAIMER_LONG}
    </p>
  )
}
