import { useRef } from 'react'
import { useFocusHeading } from '../../lib/a11y/useA11y'
import { useSession } from '../../lib/session/store'
import { speechRunner } from '../../lib/speech/speechRunner'
import { testRunner } from '../../lib/vision/useTestRunner'
import { SlotNumber } from '../ui/SlotNumber'
import { useScrollHandoff } from '../../lib/useScrollHandoff'
import { Button } from '../ui/Button'
import { Disclaimer } from '../ui/Disclaimer'
import { Icon } from '../ui/Icon'
import { MicroLabel, SectionHead } from '../ui/Primitives'
import { FAQS, HOTLINES, INFO_SECTIONS, PROCESS_STEPS, STATS, TEAM, TIME_NOTE } from './infoContent'

const section = (id: string) => INFO_SECTIONS.find((s) => s.id === id)!

/** The long scrollable document behind the home screen: what the checks are, why they matter, who to call. */
export function InfoPage() {
  const setRoute = useSession((s) => s.setRoute)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useFocusHeading(headingRef)
  const beginTests = useSession((s) => s.beginTests)
  // "Start the check" here means a NEW check. Without the reset, results, skips and any alert status from an earlier
  // run in this tab (reached via "Stroke resources" on the result screen) would carry into the new one.
  const start = () => {
    // Nothing starts before consent: without it, send the visitor to the consent panel on the home screen instead.
    if (!useSession.getState().consented) return setRoute('home')
    testRunner.cancel()
    speechRunner.cancel()
    useSession.getState().reset()
    beginTests()
  }
  // Scrolling up past the top goes back to the check, the mirror of the home page's hand-off. The explicit
  // "Back to the check" button below stays, so this gesture is a shortcut and never the only way back.
  const pull = useScrollHandoff(true, 'up', () => setRoute('home'))

  return (
    <>
      {/* Progress of the scroll-up hand-off: a thin bar across the top edge (no text label).
          A sibling of the transformed page below, NOT a child: a transformed ancestor would turn `fixed` into
          "fixed to the page", and the bar would scroll away with the document instead of staying at the window's edge. */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40" aria-hidden>
        <div className="h-1.5 bg-accent transition-[width] duration-100 ease-out" style={{ width: `${pull * 100}%` }} />
      </div>
    <div style={{ transform: `translateY(${pull * 28}px)`, opacity: 1 - pull * 0.25, transition: pull === 0 ? 'transform 300ms ease-out, opacity 300ms ease-out' : 'none' }} className="mx-auto w-full max-w-5xl px-4 pb-32 pt-24 sm:px-6 sm:pt-28">

      {/* The page's h1: the visible section titles below are h2s. Read out (and focused) when the page opens. */}
      <h1 ref={headingRef} tabIndex={-1} className="sr-only">
        How the BE-FAST check works, and who to call
      </h1>

      <Button tone="quiet" icon="arrowDown" className="mb-12 [&>svg]:rotate-180" onClick={() => setRoute('home')}>
        Back to the check
      </Button>

      <Disclaimer className="-mt-4 mb-12 max-w-[62ch] border-l-4 border-danger pl-4 text-lg font-medium leading-snug" />

      {/* 01 — Process */}
      <section id="process" className="scroll-mt-24">
        <SectionHead {...section('process')} />
        <ol className="divide-y divide-line border-y border-line">
          {PROCESS_STEPS.map((step, i) => (
            <li id={`step-${step.name.toLowerCase()}`} key={step.name} className="grid scroll-mt-28 gap-x-8 gap-y-3 py-7 sm:grid-cols-[auto_minmax(0,1fr)]">
              <div className="flex items-baseline gap-3 sm:w-24 sm:flex-col sm:items-start sm:gap-1">
                <span className="font-serif text-5xl leading-none text-accent">{step.letter}</span>
                <span className="label-micro text-ink-3">{`0${i + 1} · ${step.name}`}</span>
              </div>
              <div>
                <h3 className="text-xl font-semibold tracking-tight">{step.instruction}</h3>
                <p className="mt-2 max-w-[62ch] leading-relaxed text-ink-2">{step.looksFor}</p>
                <p className="mt-2 max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-3">{step.measured}</p>
              </div>
            </li>
          ))}
          <li id="step-time" className="grid scroll-mt-28 gap-x-8 gap-y-3 py-7 sm:grid-cols-[auto_minmax(0,1fr)]">
            <div className="flex items-baseline gap-3 sm:w-24 sm:flex-col sm:items-start sm:gap-1">
              <span className="font-serif text-5xl leading-none text-ink-3">{TIME_NOTE.letter}</span>
              <span className="label-micro text-ink-3">{`05 · ${TIME_NOTE.name}`}</span>
            </div>
            <p className="max-w-[62ch] leading-relaxed text-ink-2">{TIME_NOTE.body}</p>
          </li>
        </ol>
      </section>

      {/* 02 — Why */}
      <section id="why" className="mt-24 scroll-mt-24">
        <SectionHead {...section('why')} />
        <div className="grid gap-6 sm:grid-cols-5">
          <div className="sm:col-span-3">
            <p className="text-2xl leading-snug text-pretty">
              Every minute a stroke goes untreated, the brain loses roughly 1.9 million neurons. The medicines that can
              reverse it only work for the first few hours. That is why a stroke is treated as an emergency even when
              the signs are mild or come and go.
            </p>
            <p className="mt-5 max-w-[62ch] text-lg leading-relaxed text-ink-2">
              Many people wait because they are alone, or because they do not want to overreact. The wait is the
              costly part. A guided two-minute check walks you through the signs, but it is only a prompt to call
              911, never a substitute for it.
            </p>
            <p className="mt-4 max-w-[62ch] text-lg leading-relaxed text-ink-2">
              If the camera cannot get a good look at you, that check is left out and the result says so. Even when
              every check works, this tool cannot rule a stroke out, so it can never reassure you.
            </p>
          </div>
          <aside className="sm:col-span-2">
            <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-6">
              <MicroLabel className="mb-3">What it won&rsquo;t do</MicroLabel>
              <ul className="space-y-3 text-[1rem] leading-snug text-ink-2">
                {['Claim any medical accuracy. It has never been validated.', 'Tell you whether or not you are having a stroke.', 'Replace a call to emergency services.', 'Save your video, or keep your speech clip on our server.', 'Text anyone you haven\u2019t set up ahead of time.'].map((t) => (
                  <li key={t} className="flex gap-2.5">
                    <Icon name="close" size={16} className="mt-0.5 shrink-0 text-ink-3" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </section>

      {/* 03 — Stats */}
      <section id="stats" className="mt-24 scroll-mt-24">
        <SectionHead {...section('stats')} />
        <div className="grid gap-px overflow-hidden rounded-[var(--radius-panel)] border border-line bg-line sm:grid-cols-2">
          {STATS.map((s) => (
            <article key={s.caption} className="bg-surface p-7">
              <p className="flex items-baseline gap-2">
                <SlotNumber value={s.figure} className="tnum font-serif text-6xl leading-none" />
                <span className="label-micro text-ink-3">{s.unit}</span>
              </p>
              <p className="mt-4 max-w-[34ch] leading-relaxed text-ink-2">{s.caption}</p>
              <p className="mt-3 text-[0.875rem] text-ink-3">{s.source}</p>
            </article>
          ))}
        </div>
      </section>

      {/* 04 — Q&A + hotlines */}
      <section id="help" className="mt-24 scroll-mt-24">
        <SectionHead {...section('help')} />

        <div id="hotlines" className="mb-10 grid scroll-mt-28 gap-4 sm:grid-cols-2">
          {HOTLINES.map((h) => (
            <a
              key={h.tel}
              href={`tel:${h.tel}`}
              className={`group block rounded-[var(--radius-panel)] border p-6 transition-colors ${
                h.urgent ? 'border-danger/30 bg-danger-wash hover:bg-danger-wash/70' : 'border-line bg-surface hover:bg-sunken'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className={`text-lg font-semibold tracking-tight ${h.urgent ? 'text-danger' : ''}`}>{h.label}</p>
                <Icon name="phone" size={18} className={h.urgent ? 'text-danger' : 'text-ink-3'} />
              </div>
              <p className="mt-2 max-w-[40ch] text-[1rem] leading-snug text-ink-2">{h.detail}</p>
            </a>
          ))}
        </div>

        <div id="faq" className="scroll-mt-28 divide-y divide-line border-y border-line">
          {FAQS.map((f) => (
            <details key={f.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-lg font-medium tracking-tight [&::-webkit-details-marker]:hidden">
                {f.q}
                <Icon
                  name="chevronDown"
                  size={20}
                  className="mt-1 shrink-0 text-ink-3 transition-transform duration-200 group-open:rotate-180"
                />
              </summary>
              <p className="mt-3 max-w-[64ch] leading-relaxed text-ink-2">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* 05 — Team */}
      <section id="team" className="mt-24 scroll-mt-24">
        <SectionHead {...section('team')} />
        <ul className="grid gap-px overflow-hidden rounded-[var(--radius-panel)] border border-line bg-line sm:grid-cols-2">
          {TEAM.map((m) => (
            <li key={m.name} className="bg-surface p-7">
              <p className="text-lg font-semibold tracking-tight">{m.name}</p>
              <p className="mt-1 text-ink-2">{m.affiliation}</p>
              <p className="mt-1 text-ink-2">{m.major}</p>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-20 flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-panel)] bg-ink p-8 text-white">
        <p className="max-w-[40ch] text-xl font-medium tracking-tight text-balance">
          If you are reading this because something feels wrong right now, do the check.
        </p>
        <Button
          size="lg"
          tone="quiet"
          icon="arrowRight"
          onClick={() => {
            setRoute('home')
            start()
          }}
        >
          Start the check
        </Button>
      </div>
    </div>
    </>
  )
}
