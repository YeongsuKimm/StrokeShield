import { defineConfig } from 'vitest/config'

// Used only by `pnpm calibrate` (kept out of the normal `pnpm test` include so personal recordings never affect CI).
export default defineConfig({
  test: { environment: 'node', include: ['src/lib/calibration/calibrate.report.ts'] },
})
