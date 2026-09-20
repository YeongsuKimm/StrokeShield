import { useState } from 'react'
import { BROWSER_GRANT_NOTE } from '../../lib/privacy/consentText'
import { clearAllLocalData } from '../../lib/privacy/clearData'
import { Button } from '../ui/Button'
import { pick, useLocale } from '../../lib/i18n'

/** "Clear my data": stops the camera and microphone, hangs up the voice guide and forgets everything (docs/spec/06). */
export function ClearDataButton({ className = '' }: { className?: string }) {
  const locale = useLocale((s) => s.locale)
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'partial'>('idle')

  const clear = async () => {
    setState('busy')
    const { failed } = await clearAllLocalData()
    setState(failed.length ? 'partial' : 'done')
  }

  return (
    <div className={className}>
      <Button tone="quiet" size="sm" className="min-h-11" onClick={() => void clear()} disabled={state === 'busy'}>
        {pick(locale, 'Clear my data', 'Borrar mis datos')}
      </Button>
      <p role="status" className="mt-2 text-[0.875rem] leading-snug text-ink-3">
        {state === 'done' && pick(locale, `Cleared. Camera and microphone are off. ${BROWSER_GRANT_NOTE}`, 'Datos borrados. La c\u00e1mara y el micr\u00f3fono est\u00e1n apagados. Los permisos del navegador se administran en su configuraci\u00f3n.')}
        {state === 'partial' && pick(locale, 'Most of it is cleared, but something could not be. Close this tab to be sure.', 'Se borr\u00f3 casi todo, pero algo no pudo eliminarse. Cierra esta pesta\u00f1a para asegurarte.')}
      </p>
    </div>
  )
}
