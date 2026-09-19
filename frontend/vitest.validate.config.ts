import { defineConfig } from 'vitest/config'

// Used only by `pnpm validate` (kept out of the normal `pnpm test` include so personal recordings never affect CI).
// disableConsoleIntercept: the report is printed as plain text, without vitest's per-test stdout prefix.
export default defineConfig({
  test: { environment: 'node', testTimeout: 600_000, include: ['src/lib/calibration/validate.report.ts'], disableConsoleIntercept: true },
})
