// `pnpm calibrate`: replays committed fixtures AND your personal recordings (frontend/recordings/), prints a table of
// severities per scenario, and fails listing every run that misses its expectation (false alarm, missed deficit,
// wrong side, out-of-band severity) or needed a retry. Use it after every threshold change. See docs/CALIBRATION.md.
// (Recordings are read with node:fs in runnerCommon.ts, one at a time, so hundreds of recordings do not exhaust memory.)
import { describe, expect, it } from 'vitest'
import { formatFailures, formatTable } from './replay'
import { loadRows, NO_RECORDINGS_MESSAGE } from './runnerCommon'

describe('calibration report', () => {
  it('replays all recordings and reports', () => {
    const { rows, errors } = loadRows()
    if (rows.length === 0) {
      console.log(NO_RECORDINGS_MESSAGE)
      return
    }
    console.log(`\n${formatTable(rows)}\n`)
    const changed = rows.filter((r) => Number.isFinite(r.liveSeverity) && Math.abs(r.liveSeverity - r.result.severity) > 0.005)
    if (changed.length) {
      console.log(`Severity differs from what the app showed at record time (thresholds changed since): ${changed.length}/${rows.length}`)
      for (const r of changed.slice(0, 15)) console.log(`  ${r.file}: ${r.liveSeverity.toFixed(2)} -> ${r.result.severity.toFixed(2)}`)
      console.log('')
    }
    if (errors.length) console.log(`Unreadable files:\n  ${errors.join('\n  ')}\n`)
    const failures = formatFailures(rows)
    if (failures.length) console.log(`Runs not meeting expectations (${failures.length}):\n  ${failures.join('\n  ')}\n`)
    expect(errors).toEqual([])
    expect(failures).toEqual([])
  })
})
