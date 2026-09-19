/// <reference types="node" />
// `pnpm tune`: tables, ramp suggestions and a cutoff sweep on the TUNE split only. No pass/fail. Validation-split results
// are deliberately not shown here, so tuning cannot peek at the held-out people. See docs/CALIBRATION.md "Validation".
import { describe, expect, it } from 'vitest'
import { freezeStatus } from './freeze'
import { currentGitCommit, readFreeze } from './freezeCli'
import { buildTuneReport } from './report'
import { loadRows, NO_RECORDINGS_MESSAGE, overrideCounts } from './runnerCommon'

describe('vision tuning report', () => {
  it('prints the tune-split report', () => {
    const { rows, errors, override } = loadRows()
    if (rows.length === 0) {
      console.log(NO_RECORDINGS_MESSAGE)
      return
    }
    const meta = { date: new Date().toISOString(), gitCommit: currentGitCommit(), freeze: freezeStatus(readFreeze()), override: overrideCounts(override) }
    console.log(`\n${buildTuneReport(rows, meta)}\n`)
    if (errors.length) console.log(`Unreadable files:\n  ${errors.join('\n  ')}\n`)
    expect(errors).toEqual([])
  })
})
