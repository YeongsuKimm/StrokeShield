import { useCallback, useEffect, useState } from 'react'
import { micMonitor } from '../../lib/media/micLevel'
import { queryPermission, requestCamera, requestLocation, requestMicrophone, watchPermission } from '../../lib/media/permissions'
import { useSession, type PermissionKey, type PermissionState } from '../../lib/session/store'
import { Button } from '../ui/Button'
import { Icon, type IconName } from '../ui/Icon'
import { MicroLabel } from '../ui/Primitives'

const ROWS: { key: PermissionKey; icon: IconName; label: string; why: string }[] = [
  { key: 'camera', icon: 'camera', label: 'Camera', why: 'Sees your face and arms.' },
  { key: 'microphone', icon: 'mic', label: 'Microphone', why: 'Hears you speak.' },
  { key: 'location', icon: 'pin', label: 'Location', why: 'Tells help where you are.' },
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
  const [busy, setBusy] = useState<PermissionKey | 'all' | null>(null)

  // Reflect grants the browser already remembers, and any the patient changes mid-session.
  useEffect(() => {
    let alive = true
    const stops: (() => void)[] = []
    for (const { key } of ROWS) {
      void queryPermission(key).then((state) => alive && setPermission(key, state))
      void watchPermission(key, (state) => alive && setPermission(key, state)).then((stop) => stops.push(stop))
    }
    return () => {
      alive = false
      stops.forEach((s) => s())
    }
  }, [setPermission])

  const grant = useCallback(
    async (key: PermissionKey) => {
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
      <h2 className="text-lg font-semibold tracking-tight">Allow access</h2>

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
          disabled={busy !== null}
        >
          {busy ? 'Waiting for the browser…' : `Allow ${outstanding.length === ROWS.length ? 'all three' : 'the rest'}`}
        </Button>
      )}

      <p className="mt-3 text-[0.875rem] leading-snug text-ink-3">
        Video stays on this device.
      </p>
    </section>
  )
}
