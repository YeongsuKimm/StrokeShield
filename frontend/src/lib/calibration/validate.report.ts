/// <reference types="node" />
// `pnpm validate`: the held-out (validation split) report. Prints the FULL report (subject + file names) to stdout and, when
// VALIDATE_OUT=path is set, writes the PUBLIC report (no names) there. Fails (non-zero) if any criterion FAILS;
// INSUFFICIENT DATA is printed loudly but does not fail. Run it ONCE per frozen threshold set (see docs/CALIBRATION.md).
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { freezeStatus } from './freeze'
import { currentGitCommit, readFreeze } from './freezeCli'
import { buildValidationReport, findLeaks } from './report'
import { loadRows, NO_RECORDINGS_MESSAGE, overrideCounts } from './runnerCommon'

describe('vision validation', () => {
  it('reports on the held-out validation split', () => {
    const { rows, errors, override } = loadRows()
    if (rows.length === 0) {
      console.log(NO_RECORDINGS_MESSAGE)
      return
    }
    const freeze = freezeStatus(readFreeze())
    const meta = { date: new Date().toISOString(), gitCommit: currentGitCommit(), freeze, override: overrideCounts(override) }
    const report = buildValidationReport(rows, meta)
    console.log(`\n${report.full}\n`)
    if (freeze.state !== 'matches') console.log(`!! ${freeze.text}\n`)
    if (report.validationRuns === 0) console.log('!! INSUFFICIENT DATA: the validation split is empty. Nothing was validated.\n')
    else if (report.insufficient && !report.failed) console.log('!! INSUFFICIENT DATA: some criteria could not be evaluated yet. This is NOT a pass. See the criteria tables above.\n')
    if (errors.length) console.log(`Unreadable files:\n  ${errors.join('\n  ')}\n`)

    const out = process.env.VALIDATE_OUT
    if (out) {
      const leaks = findLeaks(report.public, rows)
      expect(leaks, 'the PUBLIC report would contain subject/file names (a subject named like a report word?); not written').toEqual([])
      const path = resolve(process.cwd(), out)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${report.public}\n`)
      console.log(`PUBLIC report written to ${path}\n`)
    }

    const failed = report.groups.flatMap((g) => g.results.filter((r) => r.status === 'FAIL').map((r) => `${g.group}: ${r.title} (${r.k}/${r.n})`))
    expect(errors).toEqual([])
    expect(failed, 'validation criteria FAILED').toEqual([])
  })
})
