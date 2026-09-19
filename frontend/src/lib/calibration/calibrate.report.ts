// `pnpm calibrate`: replays committed fixtures AND your personal recordings (frontend/recordings/), prints a table of
// severities per scenario, and fails listing every run that misses its expectation (false alarm, missed deficit,
// wrong side, out-of-band severity) or needed a retry. Use it after every threshold change. See docs/CALIBRATION.md.
import { describe, expect, it } from 'vitest'
import { loadCommitted, loadPersonal } from './loadRecordings'
import { analyzeRow, formatFailures, formatTable } from './replay'

describe('calibration report', () => {
  it('replays all recordings and reports', async () => {
    const [c, p] = await Promise.all([loadCommitted(), loadPersonal()])
    const files = [...c.ok, ...p.ok]
    const errors = [...c.errors, ...p.errors]
    if (files.length === 0) {
      console.log('\nNo recordings found. Record some with http://localhost:5173/?record=1 and put the .json files in frontend/recordings/ (see docs/CALIBRATION.md).\n')
      return
    }
    const rows = files.map(({ file, rec }) => analyzeRow(rec, file))
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
