import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '../../lib/session/store'
import { clearAllLocalData } from '../../lib/privacy/clearData'
import { setPendingAnchor } from '../../lib/anchorTarget'
import { DrilldownMenu } from '../ui/DrilldownMenu'
import { buildMenu } from './menuTree'
import { pick, useLocale } from '../../lib/i18n'

/** Mark: a shield silhouette cut by the FAST timeline. Drawn, not an image, so it stays crisp at any size. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d="M12 2.2 3.8 5.4v6.2c0 4.7 3.3 8.9 8.2 10.2 4.9-1.3 8.2-5.5 8.2-10.2V5.4Z" fill="currentColor" />
      <path d="M6.9 12.4h2.8l1.6-3.6 2 7 1.6-3.4h2.2" fill="none" stroke="var(--color-paper)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Brand + the site menu. The menu is a drilldown list (ui/DrilldownMenu): collapsed it shows only "Learn more", and
 * opening it reveals the comprehensive list of info-page sections, with "The process" and "Questions & hotlines"
 * drilling one level further. Choosing a leaf jumps to that spot on the info page. It collapses again on Escape, on a
 * click outside, and after a selection.
 */
export function SiteHeader() {
  const locale = useLocale((s) => s.locale)
  const setLocale = useLocale((s) => s.setLocale)
  const setRoute = useSession((s) => s.setRoute)
  const route = useSession((s) => s.route)
  const [depth, setDepth] = useState(0)
  // Bumping the key remounts the menu, which is how it collapses back to its single "Learn more" row.
  const [collapseKey, setCollapseKey] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  const collapse = useCallback(() => setCollapseKey((k) => k + 1), [])
  const open = depth > 0
  // Collapsed, the card hugs its single label ("Learn more" / "Sections") so there is no empty space beside it.
  const closedWidth = route === 'info' ? 'w-[7.5rem]' : 'w-[8.25rem]'

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      collapse()
      // Collapsing remounts the menu, which would drop keyboard focus on the page body: put it back on the menu button.
      requestAnimationFrame(() => wrapRef.current?.querySelector('button')?.focus())
    }
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) collapse()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open, collapse])

  // The logo is a true "start over": stop the camera, microphone and voice guide, wipe everything held about the visitor
  // (also their consent, so the next visit asks again), and land on the home screen.
  const goHome = useCallback(() => {
    void clearAllLocalData()
    setRoute('home')
    collapse()
  }, [setRoute, collapse])

  const items = useMemo(
    () =>
      buildMenu({
        locale,
        route,
        goToSection: (id) => {
          setRoute('info')
          // Only when a page swap is coming: on the info page there is no exit to consume the request, and a stale
          // one would make the NEXT swap skip its scroll-to-top.
          if (route !== 'info') setPendingAnchor(id)
          // The info page mounts after the old page finishes fading out, so poll briefly for the target.
          let tries = 0
          const seek = () => {
            const el = document.getElementById(id)
            if (el) {
              // JS smooth scrolling ignores the CSS reduced-motion override in index.css, so honour it here.
              const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
              el.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
            } else if (tries++ < 90) requestAnimationFrame(seek)
          }
          requestAnimationFrame(seek)
        },
        goToCheck: () => setRoute('home'),
      }),
    [route, setRoute, locale],
  )

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-3 p-4 sm:gap-4 sm:p-7">
      <button
        type="button"
        onClick={goHome}
        className="pointer-events-auto flex min-h-11 items-center gap-2.5 text-ink transition-opacity hover:opacity-70"
      >
        {/* The mark is dropped on the narrowest phones so brand + menu fit a 320 px screen without sideways scrolling. */}
        <span className="hidden min-[24rem]:block">
          <BrandMark />
        </span>
        <span className="font-serif text-xl leading-none sm:text-2xl">StrokeShield</span>
        <span className="sr-only">{pick(locale, 'Back to the start', 'Volver al inicio')}</span>
      </button>

      {/* The card is its own width at each level (a compact pill when collapsed, wider when open) rather than
          "auto", so the width can transition. On a phone it overlays the brand while open, which is fine for a menu. */}
      <div className="pointer-events-auto ml-auto flex items-start gap-2">
      <button
        type="button"
        onClick={() => setLocale(locale === 'en' ? 'es' : 'en')}
        lang={locale === 'en' ? 'es' : 'en'}
        aria-label={pick(locale, 'Cambiar el sitio a espa\u00f1ol', 'Switch the site to English')}
        className="min-h-12 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm font-semibold shadow-[var(--shadow-panel)] hover:bg-sunken"
      >
        {locale === 'en' ? 'ES' : 'EN'}
      </button>
      <div ref={wrapRef} className={`relative h-12 ${closedWidth}`}>
        <nav
          aria-label="Site sections"
          className={`absolute right-0 top-0 overflow-hidden rounded-[var(--radius-panel)] border border-line-strong bg-surface py-1.5 pr-3.5 transition-[width,padding,box-shadow] duration-300 ease-out ${
            // Open: extra left padding gives the breadcrumb's return arrow a gutter to sit in (it lives just left
            // of the label, so a tighter card would clip it). Both change together, so the label glides.
            open ? 'w-[min(17rem,calc(100vw-2.5rem))] pl-9 shadow-[var(--shadow-lift)]' : `${closedWidth} pl-3.5`
          }`}
        >
          <DrilldownMenu
            key={`${route}-${collapseKey}`}
            className="text-[1.0625rem]"
            items={items}
            onDepthChange={setDepth}
            onSelect={collapse}
          />
        </nav>
      </div>
      </div>
    </header>
  )
}
