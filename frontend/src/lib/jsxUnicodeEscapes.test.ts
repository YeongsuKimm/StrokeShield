import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAW_JSX_COPY = [
  'src/components/pages/HomePage.tsx',
  'src/components/test/TestScreen.tsx',
  'src/components/result/AlertPreview.tsx',
]

describe('localized JSX copy', () => {
  it('does not put JavaScript Unicode escapes in raw JSX text', () => {
    for (const path of RAW_JSX_COPY) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8')
      const rawTextNodes = source.match(/>(?:[^<{]|\{[^}]*\})*\\u[0-9a-f]{4}(?:[^<{]|\{[^}]*\})*</giu)

      expect(rawTextNodes, `${path} contains a Unicode escape that browsers render literally`).toBeNull()
    }
  })
})
