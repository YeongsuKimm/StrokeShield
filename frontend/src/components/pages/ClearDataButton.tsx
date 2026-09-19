import { useState } from 'react'
import { BROWSER_GRANT_NOTE } from '../../lib/privacy/consentText'
import { clearAllLocalData } from '../../lib/privacy/clearData'
import { Button } from '../ui/Button'

/** "Clear my data": stops the camera and microphone, hangs up the voice guide and forgets everything (docs/spec/06). */
export function ClearDataButton({ className = '' }: { className?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'partial'>('idle')

  const clear = async () => {
    setState('busy')
    const { failed } = await clearAllLocalData()
    setState(failed.length ? 'partial' : 'done')
  }

  return (
    <div className={className}>
      <Button tone="quiet" size="sm" className="min-h-11" onClick={() => void clear()} disabled={state === 'busy'}>
        Clear my data
      </Button>
      <p role="status" className="mt-2 text-[0.875rem] leading-snug text-ink-3">
        {state === 'done' && `Cleared. Camera and microphone are off. ${BROWSER_GRANT_NOTE}`}
        {state === 'partial' && 'Most of it is cleared, but something could not be. Close this tab to be sure.'}
      </p>
    </div>
  )
}
