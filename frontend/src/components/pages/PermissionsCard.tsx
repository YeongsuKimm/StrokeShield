import { useCallback, useEffect, useState } from 'react'
import { micMonitor } from '../../lib/media/micLevel'
import { queryPermission, requestCamera, requestLocation, requestMicrophone, watchPermission } from '../../lib/media/permissions'
import { useSession, type PermissionKey, type PermissionState } from '../../lib/session/store'
import { CONSENT_CHECKBOX_LABEL, CONSENT_POINTS } from '../../lib/privacy/consentText'
import { clearAllLocalData } from '../../lib/privacy/clearData'
import { Button } from '../ui/Button'
import { ClearDataButton } from './ClearDataButton'
import { Icon, type IconName } from '../ui/Icon'
import { MicroLabel } from '../ui/Primitives'

const ROWS: { key: PermissionKey; icon: IconName; label: string; why: string }[] = [
  { key: 'camera', icon: 'camera', label: 'Camera', why: 'Sees your face and arms. Video stays in this browser.' },
  { key: 'microphone', icon: 'mic', label: 'Microphone', why: 'Hears you speak. Records only when you press Start recording.' },
  { key: 'location', icon: 'pin', label: 'Location', why: 'Optional. Goes in the alert text, if one is sent.' },
]

const STATE_TEXT: Record<PermissionState, string> = {
  granted: 'Allowed',
  denied: 'Blocked',
  prompt: 'Not asked yet',
  unknown: 'Not asked yet',
}

/**
 * The consent step (docs/spec/06 "Consent modal"), as a panel rather than a modal so it can sit beside the start
 * button on the home screen and stay readable while the browser's own prompt is open.
 *
 * Location is requested here on purpose, never at alert time, so a permission dialog can never delay an emergency
 * (docs/spec/05 "Location").
 */
export function PermissionsCard() {
  const permissions = useSession((s) => s.permissions)
  const setPermission = useSession((s) => s.setPermission)
  const setLocation = useSession((s) => s.setLocation)
  const consented = useSession((s) => s.consented)
  const giveConsent = useSession((s) => s.giveConsent)
  const [busy, setBusy] = useState<PermissionKey | 'all' | null>(null)

  // Reflect grants the browser already remembers, and any the patient changes mid-session.
  useEffect(() => {
    let alive = true
    const stops: (() => void)[] = []
    for (const { key } of ROWS) {
      void queryPermission(key).then((state) => alive && setPermission(key, state))
      void watchPermission(key, (state) => alive && setPermission(key, state)).then((stop) => {
        // The card may have unmounted while the browser was answering: release the listener right away.
        if (alive) stops.push(stop)
        else stop()
      })
    }
    return () => {
      alive = false
      stops.forEach((s) => s())
    }
    // Re-read after consent changes too: withdrawing clears our copy of the grants, but the browser still holds them.
  }, [setPermission, consented])

  const grant = useCallback(
    async (key: PermissionKey) => {
      // Nothing may ask the browser for a permission before the visitor has consented.
      if (!useSession.getState().consented) return
      setBusy(key)
      try {
        if (key === 'camera') {
          setPermission('camera', await requestCamera())
        } else if (key === 'microphone') {
          const { state, stream } = await requestMicrophone()
          setPermission('microphone', state)
          if (stream) micMonitor.attach(stream) // kept open: the mute indicator and the speech check both use it
        } else {
          const { state, fix } = await requestLocation()
          setPermission('location', state)
          if (fix) setLocation(fix)
        }
      } finally {
        setBusy(null)
      }
    },
    [setPermission, setLocation],
  )

  const grantAll = async () => {
    setBusy('all')
    try {
      for (const { key } of ROWS) await grant(key) // sequential: browsers queue simultaneous prompts badly
    } finally {
      setBusy(null)
    }
  }

  const outstanding = ROWS.filter((r) => permissions[r.key] !== 'granted')

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-panel)]">
      <MicroLabel className="mb-3">First</MicroLabel>
      <h2 className="text-lg font-semibold tracking-tight">Before we start</h2>

      <ul className="mt-3 space-y-2 text-[0.9375rem] leading-snug text-ink-2">
        {CONSENT_POINTS.map(({ label, text }) => (
          <li key={label}>
            <span className="font-semibold text-ink">{label}. </span>
            {text}
          </li>
        ))}
      </ul>

      {/* Explicit, unchecked by default. Unticking withdraws consent and clears everything, so it is revocable. */}
      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-line-strong p-3">
        <input
          type="checkbox"
          checked={consented}
          onChange={(e) => (e.target.checked ? giveConsent() : void clearAllLocalData())}
          className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]"
        />
        <span className="text-[0.9375rem] font-medium leading-snug">
          {CONSENT_CHECKBOX_LABEL}
          {consented && <span className="block text-[0.875rem] font-normal text-ink-3">Untick to withdraw and clear.</span>}
        </span>
      </label>

      <h3 className="mt-5 text-base font-semibold tracking-tight">Allow access</h3>

      <ul className="mt-4 space-y-3">
        {ROWS.map(({ key, icon, label, why }) => {
          const state = permissions[key]
          const granted = state === 'granted'
          const denied = state === 'denied'
          return (
            <li key={key} className="flex gap-3">
              <span
                className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${
                  granted ? 'bg-ok-wash text-ok' : denied ? 'bg-danger-wash text-danger' : 'bg-sunken text-ink-3'
                }`}
              >
                <Icon name={granted ? 'check' : icon} size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-medium">{label}</p>
                  <span className={`label-micro ${granted ? 'text-ok' : denied ? 'text-danger' : 'text-ink-3'}`}>
                    {STATE_TEXT[state]}
                  </span>
                </div>
                <p className="mt-0.5 text-[0.9375rem] leading-snug text-ink-2">{why}</p>
                {/* Each grant is its own choice, so location (which goes into the alert text) can be skipped. */}
                {!granted && !denied && (
                  <Button
                    tone="quiet"
                    size="sm"
                    className="mt-2"
                    onClick={() => void grant(key)}
                    disabled={busy !== null || !consented}
                    aria-label={`Allow ${label.toLowerCase()}`}
                  >
                    Allow
                  </Button>
                )}
                {denied && (
                  <p className="mt-1 text-[0.875rem] leading-snug text-danger">
                    Blocked. Allow it in the address bar, then reload.
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {outstanding.length > 0 && (
        <Button
          tone="quiet"
          block
          className="mt-4"
          icon="check"
          onClick={() => void grantAll()}
          disabled={busy !== null || !consented}
        >
          {busy ? 'Waiting for the browser…' : `Allow ${outstanding.length === ROWS.length ? 'all three' : 'the rest'}`}
        </Button>
      )}

      {!consented && (
        <p className="mt-3 text-[0.875rem] leading-snug text-ink-3">Tick the box above first. Nothing is switched on until you do.</p>
      )}
      <ClearDataButton className="mt-4" />
    </section>
  )
}
