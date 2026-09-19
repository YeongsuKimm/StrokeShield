import { beforeAll, describe, expect, it } from 'vitest'
import { freezeStatus, hashConfig, snapshotConfig, visionFreezeConfig, type FreezeFile } from './freeze'
import type { Recording } from './recording'
import { analyzeRow, type Row } from './replay'
import { buildTuneReport, buildValidationReport, conditionLabel, envLabel, findLeaks, HONESTY_NOTE, type ReportMeta } from './report'
import { splitFor } from './split'
import { fakeRow, faceRecording, syntheticDataset } from './syntheticRecordings'
import { droopLeft, SYMMETRIC } from '../vision/faceTestUtils'

const noFreeze = freezeStatus(null)
const meta = (over: Partial<ReportMeta> = {}): ReportMeta => ({ date: '2026-09-19T00:00:00.000Z', gitCommit: 'deadbeefcafe', freeze: noFreeze, override: null, ...over })
const rowsOf = (recs: Recording[]): Row[] => recs.map((r, i) => analyzeRow(r, `${r.subject}__${r.scenario}__${i}.json`))
const face = (r: ReturnType<typeof buildValidationReport>) => r.groups.find((g) => g.group === 'face test')!
const statusOf = (r: ReturnType<typeof buildValidationReport>, id: string): string => face(r).results.find((c) => c.id === id)!.status

describe('synthetic dataset over many subjects', () => {
  let rows: Row[]
  beforeAll(() => {
    rows = rowsOf(
      syntheticDataset({
        subjects: 100,
        decorate: (i, run) => ({
          ...run,
          conditions: { glasses: i % 3 === 0, lighting: i < 4 ? 'dim' : 'normal', device: i === 5 ? `${run.subject}'s laptop` : 'thinkpad x1', distanceM: 0.6 },
          env: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36', hardwareConcurrency: 8, delegate: 'GPU', fps: 19.6, videoSize: '1280x720' },
        }),
      }),
    )
  }, 60_000)

  it('assigns every subject to exactly one split, stably, and about 60/40', () => {
    const bySubject = new Map<string, Set<string>>()
    for (const r of rows) bySubject.set(r.subject, (bySubject.get(r.subject) ?? new Set()).add(r.split))
    expect([...bySubject.values()].every((s) => s.size === 1)).toBe(true) // no leakage
    for (const r of rows) expect(r.split).toBe(splitFor(r.subject))
    const tuneSubjects = [...bySubject.entries()].filter(([, s]) => s.has('tune')).length
    expect(tuneSubjects).toBeGreaterThan(48)
    expect(tuneSubjects).toBeLessThan(72)
  })

  it('every synthetic run meets its anchors (so the data is a fair "constructed to pass" set)', () => {
    expect(rows.filter((r) => !r.verdict.ok).map((r) => `${r.scenario}: ${r.verdict.reason}`)).toEqual([])
  })

  it('PASSes every criterion when constructed to pass with enough runs', () => {
    const rep = buildValidationReport(rows, meta())
    const g = face(rep)
    expect(g.results.map((c) => `${c.id}=${c.status}`)).toEqual([
      'falseAlarm=PASS',
      'healthyAnchor=PASS',
      'deficitDetection=PASS',
      'sideAccuracy=PASS',
      'retryRate=PASS',
      'borderlineNoAlert=PASS',
    ])
    expect(rep.failed).toBe(false)
    expect(rep.insufficient).toBe(false)
    expect(rep.full).toMatch(/\*\*Overall: PASS\*\*/)
  })

  it('is INSUFFICIENT DATA (not PASS, not FAIL) with few subjects', () => {
    const small = rows.filter((r) => Number(r.subject.slice(1)) < 12)
    const rep = buildValidationReport(small, meta())
    expect(statusOf(rep, 'falseAlarm')).toBe('INSUFFICIENT DATA')
    expect(rep.failed).toBe(false)
    expect(rep.insufficient).toBe(true)
    expect(rep.full).toMatch(/more healthy runs with no further alarms/)
  })

  it('FAILs when a false alarm is injected into the validation split', () => {
    const validationSubject = rows.find((r) => r.split === 'validate')!.subject
    const injected = analyzeRow(faceRecording({ subject: validationSubject, scenario: 'face-healthy', spec: droopLeft(1), expected: 'healthy' }), 'injected.json')
    const rep = buildValidationReport([...rows, injected], meta())
    expect(statusOf(rep, 'falseAlarm')).toBe('FAIL')
    expect(rep.failed).toBe(true)
    expect(rep.full).toMatch(/FALSE ALARM/)
    expect(rep.full).toMatch(/injected\.json/) // FULL names the failing file
    expect(rep.public).not.toMatch(/injected\.json/)
    expect(rep.public).toMatch(/FALSE ALARM/) // ... but PUBLIC still lists the failing run, anonymously
  })

  it('a false alarm in the TUNE split does not affect the validation criteria', () => {
    const tuneSubject = rows.find((r) => r.split === 'tune')!.subject
    const injected = analyzeRow(faceRecording({ subject: tuneSubject, scenario: 'face-healthy', spec: droopLeft(1), expected: 'healthy' }), 'injected.json')
    expect(statusOf(buildValidationReport([...rows, injected], meta()), 'falseAlarm')).toBe('PASS')
  })

  it('PUBLIC report has no subject names or file names; FULL has both', () => {
    const rep = buildValidationReport(rows, meta())
    expect(findLeaks(rep.public, rows)).toEqual([])
    expect(findLeaks(rep.full, rows).length).toBeGreaterThan(50)
    for (const subject of ['s000', 's005', 's050']) expect(rep.public).not.toContain(subject)
    expect(rep.public).not.toMatch(/__.*\.json/) // recording file names look like subject__scenario__n.json
    expect(rep.full).toMatch(/validate subjects: s\d{3} \(/)
    expect(rep.public).not.toMatch(/notes about/) // free-text notes never leave the recording
  })

  it('redacts device free text that contains a subject name in the PUBLIC report only', () => {
    const rep = buildValidationReport(rows, meta())
    const person = rows.find((r) => r.subject === 's005')!
    expect(person.conditions?.device).toBe("s005's laptop")
    const inValidation = person.split === 'validate'
    if (inValidation) {
      expect(rep.public).toContain('(redacted)')
      expect(rep.full).toContain("s005's laptop")
    }
    expect(rep.public).not.toContain("s005's laptop")
    expect(conditionLabel({ device: "Sam's MacBook" }, 'device', ['sam'])).toBe('(redacted)')
    expect(conditionLabel({ device: 'thinkpad x1' }, 'device', ['sam'])).toBe('thinkpad x1')
  })

  it('has per-condition tables with n per group and warns where n < 10', () => {
    const rep = buildValidationReport(rows, meta())
    expect(rep.public).toMatch(/\*\*glasses\*\*/)
    expect(rep.public).toMatch(/\*\*lighting\*\*/)
    expect(rep.public).toMatch(/\*\*distanceM\*\*/)
    expect(rep.public).toMatch(/\| yes \| \d+ \|/)
    expect(rep.public).toMatch(/\| dim \|.*WARNING: n < 10/) // only a handful of dim-light runs by construction
    expect(rep.public).not.toMatch(/\| normal \|.*WARNING/)
  })

  it('summarises distinct device combos with counts, without the raw user agent', () => {
    const rep = buildValidationReport(rows, meta())
    expect(rep.public).toMatch(/Chrome 128 on Windows, 8 cores, GPU delegate, ~20 fps, video 1280x720 \| \d+ \| \d+ \|/)
    expect(rep.public).not.toContain('Mozilla')
  })

  it('has per-scenario, sweep, retry sections and ends with the honesty note', () => {
    const rep = buildValidationReport(rows, meta())
    for (const s of [rep.full, rep.public]) {
      expect(s).toMatch(/face-mimic-left-droop/)
      expect(s).toMatch(/\| cutoff \| tune false-pos \| tune detected \| validate false-pos \| validate detected \|/)
      expect(s).toMatch(/No retries\./)
      expect(s.trimEnd().endsWith(HONESTY_NOTE)).toBe(true)
    }
    expect(HONESTY_NOTE).toBe('Mimicked deficits are not real stroke patients: this validates screening-heuristic behaviour on volunteers, not clinical accuracy.')
  })

  it('counts retries and lists their reasons (flags[0])', () => {
    const val = rows.find((r) => r.split === 'validate')!.subject
    const retries = Array.from({ length: 3 }, () => fakeRow({ expected: 'healthy', retry: true, subject: val, split: 'validate', flags: ['look straight at the screen'] }))
    const rep = buildValidationReport([...rows, ...retries], meta())
    expect(rep.public).toMatch(/\| look straight at the screen \| 3 \|/)
  })

  it('tune report shows tune-split ramp suggestions and sweep but never validation results', () => {
    const text = buildTuneReport(rows, meta())
    expect(text).toMatch(/Ramp suggestions/)
    expect(text).toMatch(/lift_asym/)
    expect(text).toMatch(/Held-out validation split: \d+ runs from \d+ subjects/)
    expect(text).not.toMatch(/validate false-pos/)
    const validationSubject = rows.find((r) => r.split === 'validate')!.subject
    expect(text).not.toContain(validationSubject)
    expect(text.trimEnd().endsWith(HONESTY_NOTE)).toBe(true)
  })
})

describe('freeze status in the report header', () => {
  const rows = [fakeRow({ expected: 'healthy', severity: 0.05, split: 'validate' })]
  const current = snapshotConfig()
  const file = (config: unknown): FreezeFile => ({ frozenAt: '2026-09-18T00:00:00.000Z', gitCommit: 'abc1234def', hash: hashConfig(config), config: snapshotConfig(config).config })

  it('none -> matches -> changed', () => {
    const none = buildValidationReport(rows, meta({ freeze: freezeStatus(null, current) }))
    expect(none.public).toMatch(/Thresholds frozen: NO freeze file/)
    expect(none.public).toMatch(/NOT independent evidence/)

    const ok = buildValidationReport(rows, meta({ freeze: freezeStatus(file(visionFreezeConfig()), current) }))
    expect(ok.public).toMatch(/Thresholds frozen: YES \(hash matches, frozen 2026-09-18 at abc1234def\)/)
    expect(ok.public).not.toMatch(/NOT independent evidence/)

    const edited = { ...visionFreezeConfig(), RISK_THRESHOLD: 0.45 }
    const changed = buildValidationReport(rows, meta({ freeze: freezeStatus(file(edited), current) }))
    expect(changed.public).toMatch(/Thresholds frozen: NO: config changed since freeze \(frozen [0-9a-f]{16} vs current [0-9a-f]{16}\) so this is NOT independent evidence/)
  })
})

describe('edge cases', () => {
  it('an empty validation split says so loudly and is INSUFFICIENT, never PASS', () => {
    const tuneOnly = [fakeRow({ expected: 'healthy', severity: 0.05, split: 'tune' })]
    const rep = buildValidationReport(tuneOnly, meta())
    expect(rep.validationRuns).toBe(0)
    expect(rep.full).toMatch(/No validation-split runs/)
    expect(rep.failed).toBe(false)
    expect(rep.insufficient).toBe(true)
    expect(buildTuneReport([fakeRow({ expected: 'healthy', split: 'validate' })], meta())).toMatch(/No tune-split runs/)
  })

  it('pools tests only when several kinds are present', () => {
    const one = buildValidationReport([fakeRow({ expected: 'healthy', kind: 'face', split: 'validate' })], meta())
    expect(one.groups.map((g) => g.group)).toEqual(['face test'])
    const two = buildValidationReport([fakeRow({ expected: 'healthy', kind: 'face', split: 'validate' }), fakeRow({ expected: 'healthy', kind: 'arms', split: 'validate' })], meta())
    expect(two.groups.map((g) => g.group)).toEqual(['All vision tests pooled', 'face test', 'arms test'])
  })

  it('envLabel handles missing and speech-style env', () => {
    expect(envLabel(undefined)).toBe('(env not recorded)')
    expect(envLabel({ sampleRate: 48000, echoCancellation: false, noiseSuppression: false, autoGainControl: false })).toBe('48000 Hz, browser DSP off')
  })

  it('findLeaks matches whole words only', () => {
    const rows = [fakeRow({ expected: 'healthy', subject: 'li' })]
    expect(findLeaks('lighting is fine', rows)).toEqual([])
    expect(findLeaks('runs by Li today', rows)).toEqual(['subject "li"'])
  })

  it('a symmetric smile fixture is still healthy (sanity for the fixtures used above)', () => {
    expect(analyzeRow(faceRecording({ subject: 'x', scenario: 'face-healthy', spec: SYMMETRIC, expected: 'healthy' }), 'x.json').verdict.ok).toBe(true)
  })
})
