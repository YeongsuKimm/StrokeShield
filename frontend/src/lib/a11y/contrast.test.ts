import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AA_LARGE_OR_UI, AA_TEXT, blend, contrastRatio, parseHex, type Rgb } from './contrast'

// The tokens are read straight from index.css so this test fails the moment someone changes a colour there.
const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8')
const token = (name: string): Rgb => {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{3,6})`))
  if (!m) throw new Error(`token --color-${name} not found in index.css`)
  return parseHex(m[1])
}
const WHITE = parseHex('#ffffff')

describe('contrast helper', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio(parseHex('#000'), WHITE)).toBeCloseTo(21, 5)
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5)
    // #767676 on white is the well-known smallest grey that passes AA (4.54:1).
    expect(contrastRatio(parseHex('#767676'), WHITE)).toBeCloseTo(4.54, 2)
  })

  it('blends translucent paint over a background', () => {
    expect(blend(WHITE, parseHex('#000000'), 0.5)).toEqual([128, 128, 128])
    expect(blend(WHITE, parseHex('#123456'), 1)).toEqual([255, 255, 255])
  })

  it('rejects things that are not hex colours', () => {
    expect(() => parseHex('rgb(0,0,0)')).toThrow()
  })
})

// [foreground, background, minimum ratio, where it is used]
type Color = string | Rgb
const rgbOf = (c: Color): Rgb => (typeof c === 'string' ? token(c) : c)
const PAIRS: [Color, Color, number, string][] = [
  // Ink on every light surface (body text and micro-labels).
  ['ink', 'paper', AA_TEXT, 'body text on the page'],
  ['ink', 'surface', AA_TEXT, 'body text on cards'],
  ['ink', 'sunken', AA_TEXT, 'text on inset wells'],
  ['ink-2', 'paper', AA_TEXT, 'secondary text on the page'],
  ['ink-2', 'surface', AA_TEXT, 'secondary text on cards'],
  ['ink-2', 'sunken', AA_TEXT, 'secondary text on wells and pills'],
  ['ink-3', 'paper', AA_TEXT, 'muted text on the page (footer, captions)'],
  ['ink-3', 'surface', AA_TEXT, 'muted text on cards'],
  ['ink-3', 'sunken', AA_TEXT, 'muted text on wells (waveform status)'],
  // Accent.
  ['accent', 'paper', AA_TEXT, 'links and labels on the page'],
  ['accent', 'surface', AA_TEXT, 'links and labels on cards'],
  ['accent', 'accent-wash', AA_TEXT, 'accent pill'],
  [WHITE, 'accent', AA_TEXT, 'primary buttons, SMILE! card'],
  [WHITE, 'accent-press', AA_TEXT, 'pressed primary button'],
  // Status colours: as text on their wash and on white, and as solid fills with white text.
  ['danger', 'paper', AA_TEXT, 'error text on the page'],
  ['danger', 'surface', AA_TEXT, 'error text on cards'],
  ['danger', 'danger-wash', AA_TEXT, 'danger pill and call-911 card title'],
  [WHITE, 'danger', AA_TEXT, 'Call 911 button, high result band'],
  [WHITE, 'danger-press', AA_TEXT, 'Call 911 hover'],
  ['caution', 'caution-wash', AA_TEXT, 'warning banners and pills'],
  ['caution', 'surface', AA_TEXT, 'warning text on cards'],
  [WHITE, 'caution', AA_TEXT, 'framing hint pill, caution result band'],
  ['ok', 'ok-wash', AA_TEXT, 'ok pill'],
  ['ok', 'surface', AA_TEXT, 'ok text on cards'],
  [WHITE, 'ok', AA_TEXT, 'ok solid with white text'],
  [WHITE, 'ink', AA_TEXT, 'neutral low-risk band, neutral buttons'],
  // Translucent white text on the solid bands (result banner copy, Call 911 subtitle).
  [blend(WHITE, token('danger'), 0.8), 'danger', AA_TEXT, 'text-white/80 on the emergency red'],
  [blend(WHITE, token('danger'), 0.85), 'danger', AA_TEXT, 'text-white/85 on the high band'],
  [blend(WHITE, token('danger'), 0.9), 'danger', AA_TEXT, 'text-white/90 on the high band'],
  [blend(WHITE, token('caution'), 0.85), 'caution', AA_TEXT, 'text-white/85 on the caution band'],
  [blend(WHITE, token('caution'), 0.9), 'caution', AA_TEXT, 'text-white/90 on the caution band'],
  [blend(WHITE, token('ink'), 0.85), 'ink', AA_TEXT, 'text-white/85 on the low band'],
  [blend(WHITE, token('ink'), 0.9), 'ink', AA_TEXT, 'text-white/90 on the low band'],
  [blend(WHITE, token('accent'), 0.85), 'accent', AA_TEXT, 'text-white/85 on the intro card'],
  // Dark camera stage.
  ['stage-ink', 'stage', AA_TEXT, 'text on the stage'],
  ['stage-ink-2', 'stage', AA_TEXT, 'secondary text on the stage'],
  ['stage-ink', 'stage-2', AA_TEXT, 'text on the raised stage'],
  ['stage-ink', blend(WHITE, token('stage'), 0.1), AA_TEXT, 'stage button (white/10 fill)'],
  // Non-text: focus rings and the state cues that carry meaning.
  ['accent', 'paper', AA_LARGE_OR_UI, 'focus ring on the page'],
  ['accent', 'surface', AA_LARGE_OR_UI, 'focus ring on cards'],
  [parseHex('#8fc2f5'), 'stage', AA_LARGE_OR_UI, 'focus ring on the camera stage'],
  ['control-edge', 'surface', AA_LARGE_OR_UI, 'button and checkbox borders on cards'],
  ['control-edge', 'paper', AA_LARGE_OR_UI, 'button borders on the page'],
  ['control-edge', 'sunken', AA_LARGE_OR_UI, 'button borders on wells'],
  ['ink-3', 'paper', AA_LARGE_OR_UI, 'progress dots that are not yet done'],
  ['ok-stage', 'stage', AA_LARGE_OR_UI, 'framing-ok ring and guide around the camera'],
  ['caution', 'stage', AA_LARGE_OR_UI, 'framing-waiting ring around the camera'],
]

describe('design tokens meet WCAG 2.2 AA', () => {
  for (const [fg, bg, min, use] of PAIRS) {
    it(`${use} (min ${min}:1)`, () => {
      expect(contrastRatio(rgbOf(fg), rgbOf(bg))).toBeGreaterThanOrEqual(min)
    })
  }
})
