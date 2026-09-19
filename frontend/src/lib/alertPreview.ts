// The alert text, built in the browser so the patient can read exactly what the phone will receive. PURE: no DOM, no
// network, no globals.
//
// This is a line-for-line MIRROR of services/email_sms_service.py::build_short_message. Same part order, same 160
// character single segment, location rounded to 4 decimals, no patient name, control characters flattened, optional
// parts dropped when they do not fit. Both sides are pinned to tests/fixtures/alert_message_vectors.json (pytest and
// alertPreview.test.ts read the same file), so change the Python builder, the vectors and this file together.
//
// Python and JavaScript differ in three places that matter for a byte-exact mirror, handled below:
//   * length and slicing count code points in Python but UTF-16 units in JS (emoji): we count code points;
//   * str.strip() and String.trim() disagree on U+0085 (Python strips) and U+FEFF (JS strips): explicit set;
//   * "{:.4f}" / "{:.0%}" round half to even on the exact binary value, toFixed() rounds half away from zero.
import type { AlertRequest, RiskBreakdown, TestName, TestResult } from './contracts'

export const MAX_SMS_CHARS = 160

// oxlint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f\x7f]+/g
/** Python's str.strip() whitespace set (control characters were already replaced by spaces above). */
const PY_SPACE = '\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const PY_STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, 'g')
const ELLIPSIS = '\u2026' // the backend writes a real ellipsis when it shortens a part; the phone gets it too

const codePoints = (s: string): string[] => Array.from(s)

function flat(text: string, limit: number): string {
  const cleaned = text.replace(CONTROL, ' ').replace(PY_STRIP, '')
  const cps = codePoints(cleaned)
  return cps.length <= limit ? cleaned : cps.slice(0, limit - 1).join('') + ELLIPSIS
}

/** Python's `format(x, ".{digits}f")`: exact decimal value, ties to even (toFixed rounds ties away from zero). */
export function pyFixed(x: number, digits: number): string {
  const out = x.toFixed(digits)
  if (!Number.isFinite(x) || digits > 60) return out
  const long = Math.abs(x).toFixed(digits + 30)
  if (!/^50*$/.test(long.slice(long.length - 30))) return out // not an exact tie
  let kept = long.slice(0, long.length - 30)
  if (kept.endsWith('.')) kept = kept.slice(0, -1)
  const lastDigit = Number(kept[kept.length - 1])
  return lastDigit % 2 === 0 ? (x < 0 ? '-' : '') + kept : out
}

/** The text that goes to the demo phone for this request. Never contains the patient's name. */
export function buildShortMessage(req: AlertRequest): string {
  const parts = ['StrokeShield ALERT: possible stroke signs.']
  const optional = [`Last well: ${req.lastKnownWell ? flat(req.lastKnownWell, 40) : 'unknown'}.`]
  if (req.location) {
    optional.push(`Map: maps.google.com/?q=${pyFixed(req.location.lat, 4)},${pyFixed(req.location.lng, 4)}`)
  } else {
    optional.push('Location unavailable.')
  }
  if (req.symptoms.length > 0) optional.push(`Flags: ${flat(req.symptoms.join('; '), 40)}.`)
  if (req.risk) optional.push(`Risk ${pyFixed(req.risk.risk * 100, 0)}%.`)
  optional.push('Demo message.')
  for (const part of optional) {
    if (codePoints([...parts, part].join(' ')).length <= MAX_SMS_CHARS) parts.push(part)
  }
  return flat(parts.join(' '), MAX_SMS_CHARS)
}

/** The slice of the session an alert is built from. */
export interface AlertSource {
  alertReason?: AlertRequest['reason']
  risk: RiskBreakdown | null
  patientName?: string
  lastKnownWell?: string
  results: Partial<Record<TestName, TestResult>>
}

/** The request the app posts to /api/alert (also the input of the preview, so the two cannot disagree). */
export function alertRequestFromSession(st: AlertSource, location: AlertRequest['location']): AlertRequest {
  return {
    reason: st.alertReason ?? 'user_request',
    risk: st.risk ?? undefined,
    patient: { name: st.patientName },
    lastKnownWell: st.lastKnownWell,
    location,
    symptoms: Object.values(st.results).flatMap((r) => r?.flags ?? []),
  }
}

/** Preview of the text for the current session. Location is the fix cached at consent (never read again for a preview). */
export function previewMessage(st: AlertSource & { consented: boolean; location?: AlertRequest['location'] }): string | null {
  try {
    return buildShortMessage(alertRequestFromSession(st, st.consented ? st.location : undefined))
  } catch {
    return null // the preview is a courtesy: it must never get in the way of the countdown
  }
}

export type DeliveryMode = 'live' | 'demo' | 'unknown'

/** Dry-run or live, from data the app already has: /api/health, or the alert response once there is one. */
export function deliveryMode(source: { dryRun?: unknown } | null | undefined): DeliveryMode {
  if (!source || typeof source.dryRun !== 'boolean') return 'unknown'
  return source.dryRun ? 'demo' : 'live'
}
