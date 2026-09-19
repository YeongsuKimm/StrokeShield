import { useRef, type CSSProperties } from 'react'
import { useFocusHeading } from '../../lib/a11y/useA11y'
import { testSequence } from '../../lib/config'
import { useSession } from '../../lib/session/store'
import { useScrollHandoff } from '../../lib/useScrollHandoff'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Disclaimer } from '../ui/Disclaimer'
import { MicroLabel } from '../ui/Primitives'
import { PermissionsCard } from './PermissionsCard'

const CHECK_COUNT_WORD: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five' }

export function HomePage() {
  const start = useSession((s) => s.beginTests)
  const setRoute = useSession((s) => s.setRoute)
  const phase = useSession((s) => s.phase)
  const consented = useSession((s) => s.consented)
  // Only while idle: once a check has started, scrolling must never carry the patient off to the info page.
  const pull = useScrollHandoff(phase === 'idle', 'down', () => setRoute('info'))
  const steps = testSequence()
  // Coming back here (the logo, or a finished check) lands on the heading; not on the very first page load.
  const headingRef = useRef<HTMLHeadingElement>(null)
  useFocusHeading(headingRef)

  return (
    <div style={{ transform: `translateY(${-pull * 28}px)`, opacity: 1 - pull * 0.25, transition: pull === 0 ? 'transform 300ms ease-out, opacity 300ms ease-out' : 'none' }} className="relative mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col justify-center px-4 pb-28 pt-24 sm:px-6 sm:pb-24 sm:pt-28 [@media(max-height:800px)]:sm:pb-20 [@media(max-height:800px)]:sm:pt-20">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:gap-10">
        <div className="rise order-2 lg:order-1" style={{ '--i': 1 } as CSSProperties}>
          {/* The storyboard's hand-drawn arrow, above the box and curving down into it, mirrored across the box's vertical centre line (so it sits on the right and points down-left). */}
          <svg
            viewBox="0 0 120 80"
            className="mb-1 ml-auto mr-8 hidden h-14 w-24 -scale-x-100 text-accent lg:block"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M6 8C38 4 84 14 98 62" />
            <path d="M86 50l12 15M98 65l11-14" />
          </svg>
          <PermissionsCard />
        </div>

        <section
          className="rise order-1 rounded-[var(--radius-panel)] border border-line bg-surface p-7 shadow-[var(--shadow-panel)] sm:p-12 [@media(max-height:800px)]:sm:p-9 lg:order-2"
          style={{ '--i': 2 } as CSSProperties}
        >
          <MicroLabel>BE-FAST guide</MicroLabel>

          <h1 ref={headingRef} tabIndex={-1} className="mt-4 text-balance text-4xl outline-none font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            A guided BE-FAST check, in about two minutes.
          </h1>

          <p className="mt-5 max-w-[44ch] text-pretty text-lg leading-relaxed text-ink-2">
            A voice guide walks you through {CHECK_COUNT_WORD[steps.length] ?? steps.length} short BE-FAST checks. If the checks
            flag something, it can text your emergency contact with your location.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="xl" icon="arrowRight" onClick={start} disabled={!consented} aria-describedby={consented ? undefined : 'start-hint'}>
              Start the test
            </Button>
            <Button size="xl" tone="quiet" onClick={() => setRoute('info')}>
              How it works
            </Button>
          </div>

          {!consented && <p id="start-hint" className="mt-3 text-[0.9375rem] text-ink-3">Read and tick the consent box first.</p>}

          <ol className="mt-10 flex flex-wrap items-center gap-x-2 gap-y-3 border-t border-line pt-6">
            {steps.map((t, i) => (
              <li key={t} className="flex items-center gap-2">
                <span className="label-micro flex size-6 items-center justify-center rounded-full bg-sunken text-ink-2">
                  {i + 1}
                </span>
                <span className="text-[1rem] capitalize">{t}</span>
                {i < steps.length - 1 && <Icon name="arrowRight" size={14} className="ml-1 text-line-strong" />}
              </li>
            ))}
          </ol>

          <div className="mt-6 flex items-start gap-2 text-[0.9375rem] font-medium leading-snug text-ink-2">
            <Icon name="alert" size={15} className="mt-px shrink-0" />
            <Disclaimer />
          </div>
        </section>
      </div>

      {/* Scroll hand-off. The bar fills as the buffer accumulates, so the resistance is visible rather than mysterious. */}
      <div className="absolute inset-x-0 bottom-7 hidden flex-col items-center gap-2 lg:flex">
        <button
          type="button"
          onClick={() => setRoute('info')}
          className="flex flex-col items-center gap-1.5 text-ink-2 transition-colors hover:text-ink"
        >
          <span className="text-[1rem] font-medium">How it works</span>
          <Icon name="arrowDown" size={18} className={pull > 0.05 ? 'translate-y-0.5' : ''} />
        </button>
        <div className="h-0.5 w-24 overflow-hidden rounded-full bg-line" aria-hidden>
          <div className="h-full rounded-full bg-accent" style={{ width: `${pull * 100}%` }} />
        </div>
      </div>
    </div>
  )
}
