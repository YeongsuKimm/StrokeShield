// Regression guard: committed (consented) recordings must keep meeting the severity anchors after ANY threshold change.
// Personal recordings in frontend/recordings/ are deliberately ignored here; use `pnpm calibrate` for those.
import { describe, expect, it } from 'vitest'
import { loadCommitted } from './loadRecordings'
import { analyzeRow, formatFailures } from './replay'

describe('committed calibration fixtures', () => {
  it('all load, and every non-retry recording meets its expected severity band / side', async () => {
    const { ok, errors } = await loadCommitted()
    expect(errors).toEqual([])
    const failures = formatFailures(ok.map(({ file, rec }) => analyzeRow(rec, file)).filter((r) => !r.verdict.retry))
    expect(failures).toEqual([])
  })
})
