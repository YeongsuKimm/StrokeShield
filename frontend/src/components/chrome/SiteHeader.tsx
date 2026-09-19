import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { useSession } from '../../lib/session/store'
import { INFO_SECTIONS } from '../pages/infoContent'

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
 * Brand + the disclosure menu from the storyboard. Jumping to a section switches to the info document and scrolls
 * there. Closes on Escape, on outside pointer-down, and after a selection.
 */
export function SiteHeader() {
  const setRoute = useSession((s) => s.setRoute)
  const route = useSession((s) => s.route)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  const go = (id: string) => {
    setOpen(false)
    setRoute('info')
    // Wait for the info document to mount before scrolling to the section.
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-4 p-5 sm:p-7">
      <button
        type="button"
        onClick={() => setRoute('home')}
        className="pointer-events-auto flex items-center gap-2.5 text-ink transition-opacity hover:opacity-70"
      >
        <BrandMark />
        <span className="font-serif text-2xl leading-none">StrokeShield</span>
        <span className="sr-only">Back to the start</span>
      </button>

      <div ref={wrapRef} className="pointer-events-auto relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="site-menu"
          className="flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-line-strong bg-surface/80 px-4 text-[1rem] font-medium backdrop-blur-sm transition-colors hover:bg-sunken"
        >
          {route === 'info' ? 'Sections' : 'Learn more'}
          <Icon name="chevronDown" size={16} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <nav
            id="site-menu"
            className="absolute right-0 top-[calc(100%+0.5rem)] w-60 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface py-2 shadow-[var(--shadow-lift)]"
          >
            {INFO_SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => go(s.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[1rem] transition-colors hover:bg-sunken"
              >
                {s.nav}
                <Icon name="arrowUpRight" size={15} className="text-ink-3" />
              </button>
            ))}
          </nav>
        )}
      </div>
    </header>
  )
}
