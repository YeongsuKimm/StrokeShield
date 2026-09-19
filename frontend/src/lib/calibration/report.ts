// Markdown reports for `pnpm validate` / `pnpm tune`. Two renderings of the same data:
//  - FULL: stdout for the team (includes subject names and file names; never commit it),
//  - PUBLIC: for docs/validation/ (NO subject names, NO file names: only counts, rates, intervals, conditions).
// Pure: rows + meta in, strings out. Shared spec with the Python speech validator (models/validate.py).
import { CRITERIA, evaluateCriteria, overallStatus, type CriterionResult, type Status } from './criteria'
import type { FreezeStatus } from './freeze'
import type { Conditions, RecordingKind } from './recording'
import { ANCHORS, formatTable, type Row } from './replay'
import { formatSweep, formatRampSuggestions, rampInsufficiency, rampSuggestions } from './tune'
import { normalizeSubject, type Split } from './split'
import { fmt, fmtPct, wilson, Z_95_ONE_SIDED, Z_95_TWO_SIDED } from './stats'

export const HONESTY_NOTE = 'Mimicked deficits are not real stroke patients: this validates screening-heuristic behaviour on volunteers, not clinical accuracy.'

export interface ReportMeta {
  /** ISO timestamp or date. */
  date: string
  gitCommit: string | null
  freeze: FreezeStatus
  /** Counts of subjects in recordings/split.json, or null when there is no override file. */
  override: { tune: number; validate: number } | null
}

export type Mode = 'full' | 'public'

export interface GroupCriteria {
  group: string
  results: CriterionResult[]
  status: Status
}

export interface ValidationReport {
  full: string
  public: string
  groups: GroupCriteria[]
  /** True when any criterion FAILS (the runner exits non-zero). INSUFFICIENT DATA does not fail. */
  failed: boolean
  insufficient: boolean
  validationRuns: number
}

const KINDS: RecordingKind[] = ['face', 'arms', 'eyes']
const CONDITION_KEYS = ['glasses', 'facialHair', 'lighting', 'distanceM', 'device', 'mic', 'noise', 'nativeEnglish'] as const
type ConditionKey = (typeof CONDITION_KEYS)[number]
const MIN_GROUP_N = 10

const inSplit = (rows: Row[], s: Split): Row[] => rows.filter((r) => r.split === s)
const kindsPresent = (rows: Row[]): RecordingKind[] => KINDS.filter((k) => rows.some((r) => r.kind === k))
const distinctSubjects = (rows: Row[]): string[] => [...new Set(rows.map((r) => normalizeSubject(r.subject)))].sort()

/** "all" pooled group (only when more than one test kind is present) followed by one group per kind. */
function groupsOf(rows: Row[]): { name: string; kind: RecordingKind | null }[] {
  const kinds = kindsPresent(rows)
  return [...(kinds.length > 1 ? [{ name: 'All vision tests pooled', kind: null }] : []), ...kinds.map((k) => ({ name: `${k} test`, kind: k }))]
}
const pick = (rows: Row[], kind: RecordingKind | null): Row[] => (kind ? rows.filter((r) => r.kind === kind) : rows)

export function counts(rows: Row[]): { runs: number; subjects: number; healthy: number; borderline: number; deficit: number; retries: number } {
  return {
    runs: rows.length,
    subjects: distinctSubjects(rows).length,
    healthy: rows.filter((r) => r.expected === 'healthy').length,
    borderline: rows.filter((r) => r.expected === 'borderline').length,
    deficit: rows.filter((r) => r.expected === 'deficit').length,
    retries: rows.filter((r) => r.verdict.retry).length,
  }
}

// ---------- env / conditions labels ----------
function browserLabel(ua: string | undefined): string | null {
  if (!ua) return null
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'unknown OS'
  const m = /(Edg|Firefox|Chrome|Version)\/(\d+)/.exec(ua)
  const name = m ? (m[1] === 'Edg' ? 'Edge' : m[1] === 'Version' ? 'Safari' : m[1]) : 'unknown browser'
  return `${name}${m ? ` ${m[2]}` : ''} on ${os}`
}

/** Coarse device/browser label (no raw user agent), so distinct combos can be counted. */
export function envLabel(env: Row['env']): string {
  if (!env) return '(env not recorded)'
  const parts: string[] = []
  const b = browserLabel(env.userAgent)
  if (b) parts.push(b)
  if (typeof env.hardwareConcurrency === 'number') parts.push(`${env.hardwareConcurrency} cores`)
  if (typeof env.deviceMemoryGB === 'number') parts.push(`${env.deviceMemoryGB} GB`)
  if (env.screen) parts.push(`screen ${env.screen}`)
  if (env.delegate) parts.push(`${env.delegate} delegate`)
  if (typeof env.fps === 'number' && env.fps > 0) parts.push(`~${Math.round(env.fps / 5) * 5} fps`)
  if (env.videoSize) parts.push(`video ${env.videoSize}`)
  if (typeof env.sampleRate === 'number') parts.push(`${env.sampleRate} Hz`)
  const dsp = [env.echoCancellation ? 'AEC' : null, env.noiseSuppression ? 'NS' : null, env.autoGainControl ? 'AGC' : null].filter(Boolean)
  if (env.echoCancellation !== undefined || env.noiseSuppression !== undefined || env.autoGainControl !== undefined) parts.push(dsp.length ? `browser DSP on: ${dsp.join('/')}` : 'browser DSP off')
  return parts.join(', ') || '(env empty)'
}

const bucketDistance = (m: number): string => (m < 0.5 ? '<0.5 m' : m < 1 ? '0.5-1 m' : m < 2 ? '1-2 m' : '>=2 m')

/** Group label of one condition key for one row ("(unrecorded)" when missing). `redact` hides free text that contains a subject name. */
export function conditionLabel(c: Conditions | undefined, key: ConditionKey, redact: string[] = []): string {
  const v = c?.[key]
  if (v === undefined || v === null) return '(unrecorded)'
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (key === 'distanceM') return bucketDistance(v as number)
  if (key === 'device') {
    const s = String(v).trim().toLowerCase()
    if (!s) return '(unrecorded)'
    const tokens = s.split(/[^a-z0-9]+/).filter(Boolean)
    // Free text can carry a person's name ("Sam's MacBook"): hide it if a token is a subject name (short names) or contains one (>= 4 chars).
    return redact.some((name) => tokens.includes(name) || (name.length >= 4 && s.includes(name))) ? '(redacted)' : s
  }
  return String(v)
}

// ---------- sections ----------
const pctCell = (k: number, n: number): string => (n > 0 ? `${k}/${n} (${fmtPct(k / n, 1)})` : '-')

function datasetSection(rows: Row[], mode: Mode): string {
  const lines = ['| split | runs | subjects | healthy | borderline | deficit | retries |', '|---|---|---|---|---|---|---|']
  for (const s of ['tune', 'validate'] as const) {
    const c = counts(inSplit(rows, s))
    lines.push(`| ${s} | ${c.runs} | ${c.subjects} | ${c.healthy} | ${c.borderline} | ${c.deficit} | ${c.retries} |`)
  }
  if (mode === 'full') {
    for (const s of ['tune', 'validate'] as const) {
      const rs = inSplit(rows, s)
      const per = distinctSubjects(rs).map((name) => `${name} (${rs.filter((r) => normalizeSubject(r.subject) === name).length})`)
      lines.push('', `${s} subjects: ${per.join(', ') || '(none)'}`)
    }
  }
  return lines.join('\n')
}

function envSection(rows: Row[]): string {
  const combos = new Map<string, { tune: number; validate: number }>()
  for (const r of rows) {
    const key = envLabel(r.env)
    const c = combos.get(key) ?? { tune: 0, validate: 0 }
    c[r.split]++
    combos.set(key, c)
  }
  const lines = ['| device / browser combo | tune runs | validate runs |', '|---|---|---|']
  for (const [label, c] of [...combos.entries()].sort((a, b) => b[1].tune + b[1].validate - (a[1].tune + a[1].validate) || a[0].localeCompare(b[0]))) {
    lines.push(`| ${label} | ${c.tune} | ${c.validate} |`)
  }
  return lines.join('\n')
}

function criteriaTable(results: CriterionResult[]): string {
  const lines = ['| criterion | status | k/n | rate | interval | target |', '|---|---|---|---|---|---|']
  for (const r of results) {
    lines.push(`| ${r.title} | **${r.status}** | ${r.k}/${r.n} | ${fmtPct(r.rate, 1)} | ${Number.isFinite(r.interval.hi) ? r.intervalLabel : 'n/a'} | ${r.target} |`)
  }
  const notes = results.filter((r) => r.note)
  if (notes.length) lines.push('', ...notes.map((r) => `- ${r.title}: ${r.note}`))
  return lines.join('\n')
}

function conditionSection(rows: Row[], redact: string[]): string {
  const scored = rows.filter((r) => !r.verdict.retry)
  const out: string[] = []
  for (const key of CONDITION_KEYS) {
    if (!scored.some((r) => r.conditions?.[key] !== undefined && r.conditions?.[key] !== null)) continue
    const groups = new Map<string, Row[]>()
    for (const r of scored) {
      const label = conditionLabel(r.conditions, key, redact)
      groups.set(label, [...(groups.get(label) ?? []), r])
    }
    out.push(`**${key}**`, '', '| value | healthy n | false alarms | deficit n | detected (severity >= ' + ANCHORS.deficitMin + ') | note |', '|---|---|---|---|---|---|')
    for (const [label, g] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const h = g.filter((r) => r.expected === 'healthy')
      const d = g.filter((r) => r.expected === 'deficit')
      const alarms = h.filter((r) => r.alert).length
      const hits = d.filter((r) => r.result.severity >= ANCHORS.deficitMin).length
      const upper = h.length ? wilson(alarms, h.length, Z_95_ONE_SIDED).hi : NaN
      const warn = h.length < MIN_GROUP_N || d.length < MIN_GROUP_N ? `WARNING: n < ${MIN_GROUP_N} in a group, do not read into these rates` : ''
      out.push(`| ${label} | ${h.length} | ${pctCell(alarms, h.length)}${h.length ? `, upper ${fmt(upper, 3)}` : ''} | ${d.length} | ${pctCell(hits, d.length)} | ${warn} |`)
    }
    out.push('')
  }
  return out.length ? out.join('\n').trimEnd() : 'No structured conditions were recorded in these runs (older recordings, or the condition inputs were left empty).'
}

function retrySection(rows: Row[]): string {
  const retries = rows.filter((r) => r.verdict.retry)
  if (!retries.length) return 'No retries.'
  const hist = new Map<string, number>()
  for (const r of retries) {
    const reason = r.result.flags[0] ?? '(no reason given)'
    hist.set(reason, (hist.get(reason) ?? 0) + 1)
  }
  return ['| retry reason (flags[0]) | count |', '|---|---|', ...[...hist.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([reason, n]) => `| ${reason} | ${n} |`)].join('\n')
}

function condText(c: Conditions | undefined, redact: string[]): string {
  if (!c) return ''
  const parts = CONDITION_KEYS.filter((k) => c[k] !== undefined && c[k] !== null).map((k) => `${k}=${conditionLabel(c, k, redact)}`)
  return parts.length ? ` {${parts.join(', ')}}` : ''
}

function failingSection(rows: Row[], mode: Mode, redact: string[]): string {
  const failing = rows.filter((r) => !r.verdict.ok && !r.verdict.retry)
  if (!failing.length) return 'None: every scored validation run met its expectation.'
  return failing
    .map((r) =>
      mode === 'full'
        ? `- ${r.file} (${normalizeSubject(r.subject)}) [${r.scenario}] severity ${fmt(r.result.severity)}: ${r.verdict.reason}${condText(r.conditions, redact)}`
        : `- ${r.kind} [${r.scenario}] severity ${fmt(r.result.severity)}: ${r.verdict.reason}${condText(r.conditions, redact)}`,
    )
    .join('\n')
}

const fence = (s: string): string => `\`\`\`\n${s}\n\`\`\``

function header(title: string, meta: ReportMeta, mode: Mode, splitUsed: string): string[] {
  const audience = mode === 'full' ? 'FULL: contains subject and file names, do not commit or publish' : 'PUBLIC: no subject or file names'
  return [
    `# ${title}`,
    `_${audience}_`,
    '',
    `- Date: ${meta.date}`,
    `- Git commit: ${meta.gitCommit ?? 'unknown'}`,
    `- Split used: ${splitUsed}. Subject-level, deterministic: bucket = sha1(name) % 100; bucket < 60 tune, else validate${
      meta.override ? `; override file recordings/split.json lists ${meta.override.tune} tune / ${meta.override.validate} validate subjects` : '; no split.json override'
    }`,
    `- ${meta.freeze.text}`,
    ...meta.freeze.details.map((d) => `  - ${d}`),
  ]
}

export function buildValidationReport(rows: Row[], meta: ReportMeta): ValidationReport {
  const validate = inSplit(rows, 'validate')
  const tune = inSplit(rows, 'tune')
  const groups = groupsOf(rows)
  const criteria: GroupCriteria[] = groups.map((g) => {
    const results = evaluateCriteria(pick(validate, g.kind))
    return { group: g.name, results, status: overallStatus(results) }
  })
  const failed = criteria.some((c) => c.status === 'FAIL')
  const insufficient = criteria.some((c) => c.status === 'INSUFFICIENT DATA')
  const overall: Status = failed ? 'FAIL' : insufficient ? 'INSUFFICIENT DATA' : 'PASS'

  const render = (mode: Mode): string => {
    const redact = mode === 'public' ? distinctSubjects(rows) : []
    const out: string[] = [...header('StrokeShield vision validation report', meta, mode, 'validate (held-out subjects)'), '']
    const evidence = meta.freeze.state === 'matches' ? '' : ' NOT independent evidence: thresholds were not frozen before this run.'
    out.push(`**Overall: ${overall}** (${criteria.filter((c) => c.status === 'FAIL').length} group(s) with FAIL, ${criteria.filter((c) => c.status === 'INSUFFICIENT DATA').length} with INSUFFICIENT DATA).${evidence}`, '')
    if (validate.length === 0) {
      out.push(
        '**No validation-split runs.** No recorded subject hashes into the validation split (or all were overridden into tune). Record more people, or list some subjects under "validate" in recordings/split.json. Every criterion below is INSUFFICIENT DATA.',
        '',
      )
    }
    out.push('## Dataset', '', datasetSection(rows, mode), '', '## Devices and environments', '', envSection(rows), '', '## Acceptance criteria (validation split, non-retry runs unless stated)', '')
    for (const c of criteria) out.push(`### ${c.group}: ${c.status}`, '', criteriaTable(c.results), '')
    out.push(
      `Constants: false-alarm n >= ${CRITERIA.falseAlarm.minN} with one-sided 95% Wilson upper bound < ${CRITERIA.falseAlarm.maxUpper}; healthy severity <= ${ANCHORS.healthyMax} for >= ${CRITERIA.healthyAnchor.minRate}; deficits severity >= ${ANCHORS.deficitMin} for >= ${CRITERIA.deficitDetection.minRate}; correct side ${CRITERIA.sideAccuracy.minRate}; retry rate <= ${CRITERIA.retryRate.maxRate}; borderline never alerts. Intervals: Wilson, two-sided 95% (z=${Z_95_TWO_SIDED}) or one-sided 95% (z=${Z_95_ONE_SIDED}) as labelled.`,
      '',
      '## Per-scenario results (validation split)',
      '',
      fence(formatTable(validate)),
      '',
      '## Breakdown by recording condition (validation split)',
      '',
    )
    for (const k of kindsPresent(validate)) out.push(`### ${k} test`, '', conditionSection(validate.filter((r) => r.kind === k), redact), '')
    if (kindsPresent(validate).length === 0) out.push('No validation runs.', '')
    out.push('## Retry reasons (validation split)', '', retrySection(validate), '', '## Severity cutoff sweep (false-positive rate on healthy, detection rate on deficit; non-retry)', '')
    out.push('Both splits are analysed for this table. The tune columns show the people the thresholds were tuned on (expect them to look better); a `-` means that split has no runs of that kind.', '')
    for (const g of groups) out.push(`### ${g.name}`, '', formatSweep(pick(tune, g.kind), pick(validate, g.kind)), '')
    out.push('## Failing runs (validation split)', '', failingSection(validate, mode, redact), '', '## Notes', '')
    out.push(
      '- Several runs come from the same person, so runs are not independent: the intervals above are optimistic. More distinct people beats more runs per person.',
      '- Validation only counts if thresholds were frozen (`pnpm freeze`) BEFORE the validation subjects were looked at, and were not changed afterwards.',
      '',
      HONESTY_NOTE,
    )
    return out.join('\n')
  }

  return { full: render('full'), public: render('public'), groups: criteria, failed, insufficient, validationRuns: validate.length }
}

/** `pnpm tune` output: tune split only (tables, ramp suggestions, sweep). No pass/fail, and it never shows validation-split results. */
export function buildTuneReport(rows: Row[], meta: ReportMeta): string {
  const tune = inSplit(rows, 'tune')
  const heldOut = counts(inSplit(rows, 'validate'))
  const out: string[] = [...header('StrokeShield vision tuning report', meta, 'full', 'tune'), '']
  out.push(
    `Held-out validation split: ${heldOut.runs} runs from ${heldOut.subjects} subjects (results deliberately NOT shown here; use \`pnpm validate\` once, after \`pnpm freeze\`).`,
    '',
  )
  if (tune.length === 0) {
    out.push('**No tune-split runs.** No recorded subject hashes into the tune split (or all were overridden into validate). Record more people, or list some under "tune" in recordings/split.json.')
    return out.join('\n')
  }
  const c = counts(tune)
  out.push('## Dataset (tune split)', '', `${c.runs} runs, ${c.subjects} subjects (${distinctSubjects(tune).join(', ')}); ${c.healthy} healthy, ${c.borderline} borderline, ${c.deficit} deficit, ${c.retries} retries.`, '')
  out.push('## Per-scenario results (tune split)', '', fence(formatTable(tune)), '')
  out.push('## Ramp suggestions (tune split, non-retry; NEVER applied automatically)', '', 'Suggested `lo` edge = healthy 90th percentile (10th if lower is worse); suggested `hi` edge = median of deficit runs. Copy into the config by hand only if you agree, then re-run.', '', fence(formatRampSuggestions(rampSuggestions(rows), rampInsufficiency(rows))), '')
  out.push('## Severity cutoff sweep (tune split)', '')
  for (const g of groupsOf(tune)) out.push(`### ${g.name}`, '', formatSweep(pick(tune, g.kind)), '')
  const failing = tune.filter((r) => !r.verdict.ok && !r.verdict.retry)
  out.push('## Tune-split runs missing their expectation', '', failing.length ? failingSection(failing, 'full', []) : 'None.', '', HONESTY_NOTE)
  return out.join('\n')
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Subject names and file names that appear in `text` (whole words / exact file names). Empty when it is safe to publish. */
export function findLeaks(text: string, rows: Row[]): string[] {
  const hits = new Set<string>()
  for (const name of distinctSubjects(rows)) {
    if (name && new RegExp(`(^|[^a-z0-9])${escapeRe(name)}([^a-z0-9]|$)`, 'i').test(text)) hits.add(`subject "${name}"`)
  }
  for (const r of rows) if (r.file && text.includes(r.file)) hits.add(`file "${r.file}"`)
  return [...hits]
}
