import { useCallback, useEffect, useState } from 'react'
import { micMonitor } from '../../lib/media/micLevel'
import {
  isInsecureContext,
  problemText,
  queryPermission,
  requestCamera,
  requestLocation,
  requestMicrophone,
  watchPermission,
  type PermissionProblem,
} from '../../lib/media/permissions'
import { useSession, type PermissionKey, type PermissionState } from '../../lib/session/store'
import { CONSENT_CHECKBOX_LABEL, CONSENT_POINTS } from '../../lib/privacy/consentText'
import { clearAllLocalData } from '../../lib/privacy/clearData'
import { Button } from '../ui/Button'
import { ClearDataButton } from './ClearDataButton'
import { Icon, type IconName } from '../ui/Icon'
import { pick, useLocale, type Locale } from '../../lib/i18n'

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

const ROWS_ES: typeof ROWS = [
  { key: 'camera', icon: 'camera', label: 'C\u00e1mara', why: 'Ve tu cara y tus brazos. El video permanece en este navegador.' },
  { key: 'microphone', icon: 'mic', label: 'Micr\u00f3fono', why: 'Te escucha hablar. Solo graba cuando pulsas Empezar a grabar.' },
  { key: 'location', icon: 'pin', label: 'Ubicaci\u00f3n', why: 'Opcional. Se incluye en el mensaje de alerta, si se env\u00eda.' },
]
const STATE_TEXT_ES: Record<PermissionState, string> = { granted: 'Permitido', denied: 'Bloqueado', prompt: 'A\u00fan no solicitado', unknown: 'A\u00fan no solicitado' }
const CONSENT_POINTS_ES = [
  { label: 'No es un diagn\u00f3stico', text: 'Esta demo no puede confirmar ni descartar un derrame cerebral.' },
  { label: 'Tus dispositivos', text: 'Nada se activa hasta que des tu consentimiento y concedas acceso.' },
  { label: 'En una emergencia', text: 'Llama al 911 de inmediato. No esperes el resultado de esta revisi\u00f3n.' },
]
const localizedProblem = (locale: Locale, key: PermissionKey, problem: PermissionProblem) =>
  locale === 'es' ? `No pudimos usar ${key === 'camera' ? 'la c\u00e1mara' : key === 'microphone' ? 'el micr\u00f3fono' : 'la ubicaci\u00f3n'}. Revisa los permisos del navegador e int\u00e9ntalo de nuevo.` : problemText(key, problem)

/**
 * The consent step (docs/spec/06 "Consent modal"), as a panel rather than a modal so it can sit beside the start
 * button on the home screen and stay readable while the browser's own prompt is open.
 *
 * Location is requested here on purpose, never at alert time, so a permission dialog can never delay an emergency
 * (docs/spec/05 "Location").
 */
export function PermissionsCard() {
  const locale = useLocale((s) => s.locale)
  const rows = locale === 'es' ? ROWS_ES : ROWS
  const permissions = useSession((s) => s.permissions)
  const setPermission = useSession((s) => s.setPermission)
  const setLocation = useSession((s) => s.setLocation)
  const hasFix = useSession((s) => !!s.location)
  const consented = useSession((s) => s.consented)
  const giveConsent = useSession((s) => s.giveConsent)
  const [busy, setBusy] = useState<PermissionKey | 'all' | null>(null)
  // Why the last attempt for a row failed (blocked vs dismissed vs no device vs busy...), so the text can say what to do.
  const [problems, setProblems] = useState<Partial<Record<PermissionKey, PermissionProblem>>>({})
  const insecure = isInsecureContext()

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
        let state: PermissionState
        let problem: PermissionProblem | null
        if (key === 'camera') {
          ;({ state, problem } = await requestCamera())
        } else if (key === 'microphone') {
          const r = await requestMicrophone()
          ;({ state, problem } = r)
          // Consent may have been withdrawn while the browser prompt was open: do not keep a device we no longer may hold.
          if (r.stream && !useSession.getState().consented) r.stream.getTracks().forEach((t) => t.stop())
          else if (r.stream) micMonitor.attach(r.stream) // kept open: the mute indicator and the speech check both use it
        } else {
          const r = await requestLocation()
          ;({ state, problem } = r)
          if (r.fix && useSession.getState().consented) setLocation(r.fix)
        }
        if (!useSession.getState().consented) return
        // 'unknown' = the attempt failed for a reason that says nothing about the grant (device busy, none found,
        // insecure page): keep whatever the browser last told us instead of overwriting it.
        if (state !== 'unknown') setPermission(key, state)
        setProblems((p) => ({ ...p, [key]: problem ?? undefined }))
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

  const outstanding = rows.filter((r) => permissions[r.key] !== 'granted')

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-panel)]">
      <h2 className="text-lg font-semibold tracking-tight">{pick(locale, 'Before we start', 'Antes de empezar')}</h2>

      <ul className="mt-3 space-y-2 text-[0.9375rem] leading-snug text-ink-2">
        {pick(locale, CONSENT_POINTS, CONSENT_POINTS_ES).map(({ label, text }) => (
          <li key={label}>
            <span className="font-semibold text-ink">{label}. </span>
            {text}
          </li>
        ))}
      </ul>

      {/* Explicit, unchecked by default. Unticking withdraws consent and clears everything, so it is revocable. */}
      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-control-edge p-3">
        <input
          type="checkbox"
          checked={consented}
          onChange={(e) => (e.target.checked ? giveConsent() : void clearAllLocalData())}
          className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]"
        />
        <span className="text-[0.9375rem] font-medium leading-snug">
          {pick(locale, CONSENT_CHECKBOX_LABEL, 'Entiendo y doy mi consentimiento para realizar esta revisi\u00f3n de demostraci\u00f3n.')}
          {consented && <span className="block text-[0.875rem] font-normal text-ink-3">{pick(locale, 'Untick to withdraw and clear.', 'Desmarca para retirar el consentimiento y borrar los datos.')}</span>}
        </span>
      </label>

      <h3 className="mt-5 text-base font-semibold tracking-tight">{pick(locale, 'Allow access', 'Permitir acceso')}</h3>
      {insecure && (
        <p className="mt-2 text-[0.875rem] leading-snug text-danger" role="alert">
          {localizedProblem(locale, 'camera', 'insecure')}
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {rows.map(({ key, icon, label, why }) => {
          const state = permissions[key]
          const granted = state === 'granted'
          const denied = state === 'denied'
          // Location can be "allowed" yet have no fix (indoors, timeout): offer another try, and say so.
          const problem = insecure ? undefined : problems[key] // insecure has one banner, not three repeated rows
          const noFix = key === 'location' && granted && !hasFix && !!problem
          // Allowed but the device would not start (in use elsewhere, unplugged): still worth telling them now.
          const deviceProblem = problem === 'busy' || problem === 'no-device'
          const again = !granted || noFix || deviceProblem
          const showProblem = !!problem && again && !(problem === 'denied' && !denied)
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
                    {pick(locale, STATE_TEXT[state], STATE_TEXT_ES[state])}
                  </span>
                </div>
                <p className="mt-0.5 text-[0.9375rem] leading-snug text-ink-2">{why}</p>
                {/* Each grant is its own choice, so location (which goes into the alert text) can be skipped. */}
                {again && (
                  <Button
                    tone="quiet"
                    size="md"
                    className="mt-2"
                    onClick={() => void grant(key)}
                    disabled={busy !== null || !consented || insecure}
                    aria-label={`${denied || problem ? pick(locale, 'Try again: allow', 'Intentar de nuevo: permitir') : pick(locale, 'Allow', 'Permitir')} ${label.toLowerCase()}`}
                  >
                    {denied || problem ? pick(locale, 'Try again', 'Intentar de nuevo') : pick(locale, 'Allow', 'Permitir')}
                  </Button>
                )}
                {denied && !showProblem && (
                  <p className="mt-1 text-[0.875rem] leading-snug text-danger" role="alert">
                    {localizedProblem(locale, key, 'denied')}
                  </p>
                )}
                {showProblem && problem && (
                  <p className="mt-1 text-[0.875rem] leading-snug text-danger" role="alert">
                    {localizedProblem(locale, key, problem)}
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
          {busy ? pick(locale, 'Waiting for the browser\u2026', 'Esperando al navegador\u2026') : pick(locale, `Allow ${outstanding.length === ROWS.length ? 'all three' : 'the rest'}`, `Permitir ${outstanding.length === rows.length ? 'los tres' : 'los restantes'}`)}
        </Button>
      )}

      {!consented && (
        <p className="mt-3 text-[0.875rem] leading-snug text-ink-3">{pick(locale, 'Tick the box above first. Nothing is switched on until you do.', 'Marca primero la casilla de arriba. Nada se activa hasta que lo hagas.')}</p>
      )}
      <ClearDataButton className="mt-4" />
    </section>
  )
}
