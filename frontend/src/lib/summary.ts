// "Copy summary": a plain-text note the patient can paste into a message or read to a paramedic. PURE: no DOM, no
// network, no globals (the clock and time zone are passed in). Nothing here is stored or sent by the app.
//
// It deliberately leaves OUT the location, any name, and every raw metric or score. The result is worded exactly as
// on the screen (lib/copy/features.ts), which never says "all clear" or gives a diagnosis.
import type { ResultBand } from './config'
import type { TestName, TestResult } from './contracts'
import { RESULT_BAND_COPY, SUMMARY_COPY as C } from './copy/features'
import { DISCLAIMER_SHORT } from './disclaimer'

export interface SummaryInput {
  now: Date
  /** IANA zone for the date line; omit to use the device's zone. */
  timeZone?: string
  band: ResultBand
  order: readonly TestName[]
  results: Partial<Record<TestName, TestResult>>
  skipped: readonly TestName[]
  lastKnownWell?: string
}

// oxlint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f\x7f]+/g

/** A flag is plain words; if an analyzer ever appends a number in brackets (e.g. "(CER 0.30)") that number is dropped. */
export function plainFlag(flag: string): string {
  return flag
    .replace(CONTROL, ' ')
    .replace(/\s*\([^)]*\d[^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function formatWhen(now: Date, timeZone?: string): string {
  try {
    return now.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone })
  } catch {
    return now.toISOString()
  }
}

/** Free text the visitor typed: one line, at most 200 characters (the same cap the alert uses). */
const oneLine = (text: string): string => text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)

export function buildSummary(input: SummaryInput): string {
  const { results, skipped, order } = input
  const done = order.filter((t) => !skipped.includes(t) && results[t] && !results[t]?.needsRetry)
  const notDone = order.filter((t) => !done.includes(t))
  const names = (list: readonly TestName[]): string => (list.length ? list.map((t) => C.checkNames[t]).join(', ') : C.none)

  const lines = [C.title, C.guideOnly, '', `${C.date}: ${formatWhen(input.now, input.timeZone)}`]
  lines.push(`${C.completed}: ${names(done)}`)
  lines.push(`${C.skipped}: ${names(notDone)}`)
  if (done.length) {
    lines.push('')
    for (const t of done) {
      const flags = (results[t]?.flags ?? []).map(plainFlag).filter(Boolean)
      lines.push(`${C.checkNames[t]}: ${flags.length ? flags.join('; ') : C.nothingFlagged}`)
    }
  }
  const band = RESULT_BAND_COPY[input.band]
  lines.push('', `${C.result}: ${band.label}. ${band.body}`)
  const well = input.lastKnownWell ? oneLine(input.lastKnownWell) : ''
  if (well) lines.push(`${C.lastWell}: ${well}`)
  lines.push('', DISCLAIMER_SHORT, C.call911)
  return lines.join('\n')
}
