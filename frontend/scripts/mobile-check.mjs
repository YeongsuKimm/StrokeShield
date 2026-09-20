// Phone-layout regression check. Not part of `pnpm test`: it needs a running dev server and a real browser engine,
// so CI stays on vitest and this is run by hand (`pnpm test:mobile`) after touching any screen.
//
// What it CAN catch: content wider than the screen, a floating control sitting on top of the camera or the page
// header, tap targets below the 44px minimum, and a check screen that no longer fits without scrolling.
//
// What it CANNOT catch, and what docs/MOBILE-TEST.md exists for: anything involving a real camera, a real microphone
// or real iOS audio behaviour. Chromium's phone emulation is the right shape, but it is still Chromium on a desktop.
import { chromium, devices } from 'playwright'

const URL = process.env.SS_URL ?? 'http://localhost:5174/'
const MIN_TAP = 44
// Visually-hidden skip link: 1x1 until it is focused, which is exactly how it is supposed to behave.
const IGNORE_TAP = [/^skip to the main content$/i]

const PHONES = ['iPhone 12', 'Pixel 5']
const PHASES = ['eyes', 'face', 'arms', 'speech']

const problems = []
const note = (where, msg) => problems.push(`${where}: ${msg}`)

/** Everything measured in one pass, so a screen is only rendered once. */
const measure = () => {
  const vw = innerWidth
  const overflow = document.documentElement.scrollWidth - vw
  const rect = (el) => el?.getBoundingClientRect()
  const hit = (a, b) => !!a && !!b && !(a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left)

  const stage = rect(document.querySelector('[style*="aspect-ratio"]'))
  const nav = rect(document.querySelector('nav[aria-label="Site sections"]'))
  const h1 = rect(document.querySelector('h1'))
  const floating = [...document.querySelectorAll('body *')]
    .filter((e) => getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().width > 0)
    .filter((e) => e.getBoundingClientRect().top > innerHeight / 2) // the bottom controls only
    .map((e) => ({ name: (e.innerText || e.tagName).replace(/\s+/g, ' ').trim().slice(0, 20), r: e.getBoundingClientRect() }))

  const small = [...document.querySelectorAll('button, a[href], summary, input, label[for]')]
    .map((e) => {
      const c = getComputedStyle(e)
      if (c.visibility === 'hidden' || c.display === 'none') return null
      // A checkbox inside a label is tapped by the whole label, which is what the thumb actually has to hit. Measure
      // that instead of the box itself, or every correctly-built checkbox looks like a failure.
      const target = e.tagName === 'INPUT' && e.closest('label') ? e.closest('label') : e
      const r = target.getBoundingClientRect()
      if (!r.width) return null
      return { name: (e.innerText || e.getAttribute('aria-label') || e.tagName).replace(/\s+/g, ' ').trim().slice(0, 28), w: Math.round(r.width), h: Math.round(r.height) }
    })
    .filter(Boolean)

  return {
    vh: innerHeight,
    overflow,
    small,
    navOverTitle: hit(nav, h1),
    stage: stage && { top: Math.round(stage.top), bottom: Math.round(stage.bottom) },
    stageFits: stage ? stage.bottom <= innerHeight : null,
    overStage: floating.filter((f) => hit(f.r, stage)).map((f) => f.name),
  }
}

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })

for (const phone of PHONES) {
  const ctx = await browser.newContext({ ...devices[phone], permissions: ['camera', 'microphone'] })
  const page = await ctx.newPage()
  const crashes = []
  page.on('pageerror', (e) => crashes.push(e.message))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  for (const screen of ['home', ...PHASES, 'info']) {
    if (screen === 'home') {
      await page.evaluate(async () => {
        const m = await import('/src/lib/session/store.ts')
        m.useSession.setState({ phase: 'idle', route: 'home' })
      })
    } else if (screen === 'info') {
      await page.evaluate(async () => {
        const m = await import('/src/lib/session/store.ts')
        m.useSession.setState({ phase: 'idle', route: 'info' })
      })
    } else {
      await page.evaluate(async (ph) => {
        const m = await import('/src/lib/session/store.ts')
        m.useSession.setState({ consented: true, phase: ph, route: 'home' })
      }, screen)
    }
    await page.waitForTimeout(1400)

    const r = await page.evaluate(measure)
    const where = `${phone} / ${screen}`
    if (r.overflow > 0) note(where, `${r.overflow}px wider than the screen`)
    if (r.navOverTitle) note(where, 'the header menu is sitting on the page title')
    for (const name of r.overStage) note(where, `"${name}" is covering the camera`)
    if (r.stage && !r.stageFits) note(where, `the camera runs ${r.stage.bottom - r.vh}px past the bottom of the screen`)
    for (const t of r.small) {
      if (IGNORE_TAP.some((re) => re.test(t.name))) continue
      if (t.h < MIN_TAP || t.w < MIN_TAP) note(where, `"${t.name}" is ${t.w}x${t.h}, under the ${MIN_TAP}px tap minimum`)
    }
    console.log(`  checked ${where}`)
  }
  for (const c of [...new Set(crashes)]) note(phone, `page error: ${c}`)
  await ctx.close()
}

await browser.close()

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`)
  for (const p of problems) console.error('  ✗ ' + p)
  process.exit(1)
}
console.log('\nNo phone-layout problems found.')
