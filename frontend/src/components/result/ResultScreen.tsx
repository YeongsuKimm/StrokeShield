import { useRef, type RefObject } from 'react'
import { useFocusHeading } from '../../lib/a11y/useA11y'
import { resultBand, type ResultBand } from '../../lib/config'
import { useSession } from '../../lib/session/store'
import { lazyChunk } from '../../lib/resilience/lazyChunk'
import { LazyBoundary } from '../LazyBoundary'
import { AlertStatus } from './AlertStatus'
import { ClearDataButton } from '../pages/ClearDataButton'
import { ProgressDots } from '../test/ProgressDots'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Disclaimer } from '../ui/Disclaimer'
import { MicroLabel } from '../ui/Primitives'

// The detail dashboard is below the fold and never needed to act: it loads after the verdict and Call 911 are on screen.
const Dashboard = lazyChunk(() => import('../Dashboard').then((m) => ({ default: m.Dashboard })))

/** Nearby emergency departments, via a plain maps search — no API key, works offline-of-our-backend. */
const HOSPITAL_SEARCH = 'https://www.google.com/maps/search/emergency+room+near+me'

function Banner({ band, risk, headingRef }: { band: ResultBand; risk: number; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const copy = {
    high: {
      tone: 'bg-danger text-white',
      label: 'The checks flagged possible signs',
      body: 'One or more checks came back abnormal. This is not a diagnosis, but treat it as an emergency: call 911 now.',
    },
    caution: {
      tone: 'bg-caution text-white',
      label: 'One check was borderline',
      body: 'This tool cannot tell whether it means anything. If this is new, or you are worried, call 911 or get seen right away.',
    },
    low: {
      tone: 'bg-ink text-white', // neutral, not green: green could reassure someone who then delays care
      label: 'These checks did not flag anything',
      body: 'That does not mean you are not having a stroke: these checks cannot rule one out. If you have any symptoms now, or they start or change, call 911 right away.',
    },
  }[band]

  return (
    <div className={`rounded-[var(--radius-panel)] p-8 sm:p-10 ${copy.tone}`}>
      <div className="flex items-center gap-2 text-white/85">
        <Icon name="alert" size={17} />
        <span className="label-micro">Result</span>
      </div>
      {/* Focus lands here when the result appears; aria-describedby makes the advice underneath be read with it. */}
      <h1
        ref={headingRef}
        tabIndex={-1}
        aria-describedby="result-advice"
        className="mt-3 text-balance text-4xl font-semibold leading-tight tracking-tight outline-none sm:text-5xl"
      >
        {copy.label}
      </h1>
      <p id="result-advice" className="mt-4 max-w-[52ch] text-pretty text-lg leading-relaxed text-white/90">{copy.body}</p>
      <p className="tnum mt-6 text-[0.9375rem] text-white/85">Combined check score {Math.round(risk * 100)}% (uncalibrated)</p>
      <Disclaimer className="mt-2 max-w-[60ch] text-[0.9375rem] font-medium text-white/95" />
    </div>
  )
}

function ActionCard({
  icon,
  title,
  body,
  action,
  href,
  onClick,
  tone = 'quiet',
}: {
  icon: Parameters<typeof Icon>[0]['name']
  title: string
  body: string
  /** The labelled affordance at the foot of the card — a bare arrow tells the patient nothing. */
  action: string
  href?: string
  onClick?: () => void
  tone?: 'quiet' | 'danger'
}) {
  const className = `group flex h-full flex-col rounded-[var(--radius-panel)] border p-6 text-left transition-colors ${
    tone === 'danger' ? 'border-danger/30 bg-danger-wash hover:bg-danger-wash/70' : 'border-line bg-surface hover:bg-sunken'
  }`
  const inner = (
    <>
      <span
        className={`flex size-10 items-center justify-center rounded-full ${
          tone === 'danger' ? 'bg-danger/12 text-danger' : 'bg-accent-wash text-accent'
        }`}
      >
        <Icon name={icon} size={20} />
      </span>
      <h2 className={`mt-4 text-lg font-semibold tracking-tight ${tone === 'danger' ? 'text-danger' : ''}`}>{title}</h2>
      <p className="mt-1.5 text-[1rem] leading-snug text-ink-2">{body}</p>
      <span
        className={`mt-auto flex items-center gap-1.5 pt-4 text-[0.9375rem] font-medium ${
          tone === 'danger' ? 'text-danger' : 'text-accent'
        }`}
      >
        {action}
        {href?.startsWith('http') && <span className="sr-only">(opens in a new tab)</span>}
        <Icon name="arrowRight" size={15} className="transition-transform duration-200 group-hover:translate-x-0.5" />
      </span>
    </>
  )
  return href ? (
    <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className={className}>
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  )
}

/**
 * The verdict, in the three bands from the storyboard. `high` is only ever reached after the countdown was
 * cancelled or the alert was sent — an untouched high-risk result goes straight to the countdown from the store.
 */
export function ResultScreen() {
  const risk = useSession((s) => s.risk)
  const phase = useSession((s) => s.phase)
  const requestEmergency = useSession((s) => s.requestEmergency)
  const setRoute = useSession((s) => s.setRoute)
  const reset = useSession((s) => s.reset)

  const value = risk?.risk ?? 0
  const band = phase === 'alerted' || phase === 'alerting' ? 'high' : resultBand(value)

  // Focus the verdict when the screen appears, and again whenever the phase moves on while it is showing (the countdown
  // dialog closing would otherwise leave focus on nothing). Not during the countdown itself: the dialog owns focus then.
  const headingRef = useRef<HTMLHeadingElement>(null)
  useFocusHeading(headingRef, phase, phase !== 'countdown')

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-28 pt-24 sm:px-6 sm:pt-28">
      <div className="mb-8 flex justify-center">
        <ProgressDots />
      </div>

      <Banner band={band} risk={value} headingRef={headingRef} />

      {/* What actually happened on the alert path. */}
      <AlertStatus />

      {/* Actions. The high band keeps them too: a cancelled countdown still needs a way to get help. */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <ActionCard
          icon="phone"
          tone="danger"
          title="Call 911"
          body="Ambulance now. Paramedics can start treatment before you reach the hospital."
          action="Dial now"
          href="tel:911"
        />
        <ActionCard
          icon="user"
          title="Text the demo contact"
          body="Send a text to the demo phone we set up ahead of time, with your location if you allowed it and what the checks found. It does not reach emergency services."
          action="Send the text"
          onClick={() => requestEmergency('user_request')}
        />
        <ActionCard
          icon="hospital"
          title="Emergency rooms nearby"
          body="Find the closest emergency department. Do not drive yourself."
          action="Open the map"
          href={HOSPITAL_SEARCH}
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button tone="quiet" icon="arrowUpRight" onClick={() => setRoute('info')}>
          Stroke resources and hotlines
        </Button>
        <Button tone="quiet" icon="refresh" onClick={reset}>
          Run the check again
        </Button>
      </div>
      <ClearDataButton className="mt-4" />

      <section className="mt-14">
        <MicroLabel level={2} className="mb-4">
          What the checks measured
        </MicroLabel>
        <LazyBoundary what="The details" reset={Dashboard.reset}>
          <Dashboard />
        </LazyBoundary>
      </section>
    </div>
  )
}
