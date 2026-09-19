import type { CSSProperties } from 'react'
import { testSequence } from '../../lib/config'
import { useSession } from '../../lib/session/store'
import { useScrollHandoff } from '../../lib/useScrollHandoff'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { MicroLabel } from '../ui/Primitives'
import { PermissionsCard } from './PermissionsCard'

const CHECK_COUNT_WORD: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five' }

export function HomePage() {
  const start = useSession((s) => s.beginTests)
  const setRoute = useSession((s) => s.setRoute)
  const phase = useSession((s) => s.phase)
  // Only while idle: once a check has started, scrolling must never carry the patient off to the info page.
  const pull = useScrollHandoff(phase === 'idle', 'down', () => setRoute('info'))
  const steps = testSequence()

  return (
    <div style={{ transform: `translateY(${-pull * 28}px)`, opacity: 1 - pull * 0.25, transition: pull === 0 ? 'transform 300ms ease-out, opacity 300ms ease-out' : 'none' }} className="relative mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col justify-center px-4 pb-28 pt-24 sm:px-6 sm:pb-24 sm:pt-28 [@media(max-height:800px)]:sm:pb-20 [@media(max-height:800px)]:sm:pt-20">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:gap-10">
        <div className="rise order-2 lg:order-1 lg:pt-6" style={{ '--i': 1 } as CSSProperties}>
          <PermissionsCard />
          {/* The storyboard's hand-drawn arrow, sweeping up and to the right at the start button. */}
          <svg
            viewBox="0 0 120 80"
            className="ml-6 mt-1 hidden h-16 w-28 text-accent lg:block"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M4 70C22 72 66 66 98 24" />
            <path d="M80 26l19-3M99 23l3 19" />
          </svg>
        </div>

        <section
          className="rise order-1 rounded-[var(--radius-panel)] border border-line bg-surface p-7 shadow-[var(--shadow-panel)] sm:p-12 [@media(max-height:800px)]:sm:p-9 lg:order-2"
          style={{ '--i': 2 } as CSSProperties}
        >
          <MicroLabel>Stroke check</MicroLabel>

          <h1 className="mt-4 text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            Check for a stroke in two minutes.
          </h1>

          <p className="mt-5 max-w-[44ch] text-pretty text-lg leading-relaxed text-ink-2">
            A voice guide walks you through {CHECK_COUNT_WORD[steps.length] ?? steps.length} short checks. If something
            looks wrong, it texts your emergency contact with your location.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="xl" icon="arrowRight" onClick={start}>
              Start the test
            </Button>
            <Button size="xl" tone="quiet" onClick={() => setRoute('info')}>
              How it works
            </Button>
          </div>

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

          <p className="mt-6 flex items-start gap-2 text-[0.9375rem] leading-snug text-ink-3">
            <Icon name="alert" size={15} className="mt-px shrink-0" />
            Not a medical device. In an emergency, call 911.
          </p>
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
