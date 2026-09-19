// WCAG 2.x colour-contrast maths. Pure functions (AGENTS.md rule 4), used by contrast.test.ts to keep the design
// tokens in src/index.css at AA. Hex only (#rgb / #rrggbb), because that is all the tokens use.

export type Rgb = readonly [number, number, number]

export function parseHex(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not a hex colour: ${hex}`)
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

/** Relative luminance per WCAG 2.x (sRGB). */
export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Paint `fg` at `alpha` (0-1) over an opaque `bg`, the way `text-white/85` or `bg-ink/80` renders. */
export function blend(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  const mix = (i: 0 | 1 | 2) => Math.round(fg[i] * alpha + bg[i] * (1 - alpha))
  return [mix(0), mix(1), mix(2)]
}

/** Contrast ratio between two opaque colours, 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** WCAG AA minimum: 4.5 for body text, 3 for large text (>= 24 px, or >= 18.66 px bold) and for UI components. */
export const AA_TEXT = 4.5
export const AA_LARGE_OR_UI = 3
