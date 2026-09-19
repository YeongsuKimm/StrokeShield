import { resultBand, type ResultBand } from '../../lib/config'
import { useSession } from '../../lib/session/store'
import { lazyChunk } from '../../lib/resilience/lazyChunk'
import { LazyBoundary } from '../LazyBoundary'
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

function Banner({ band, risk }: { band: ResultBand; risk: number }) {
  const copy = {
    high: {
      tone: 'bg-danger text-white',
      label: 'The checks flagged possible signs',
      body: 'Several checks came back abnormal. This is not a diagnosis, but treat it as an emergency: call 911 now.',
    },
    caution: {
      tone: 'bg-caution text-white',
      label: 'Something showed up',
      body: 'The checks found something borderline. This tool cannot tell whether it means anything. If this is new, or you are worried, call 911 or get seen right away.',
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
      <h1 className="mt-3 text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{copy.label}</h1>
      <p className="mt-4 max-w-[52ch] text-pretty text-lg leading-relaxed text-white/90">{copy.body}</p>
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
      <h3 className={`mt-4 text-lg font-semibold tracking-tight ${tone === 'danger' ? 'text-danger' : ''}`}>{title}</h3>
      <p className="mt-1.5 text-[1rem] leading-snug text-ink-2">{body}</p>
      <span
        className={`mt-auto flex items-center gap-1.5 pt-4 text-[0.9375rem] font-medium ${
          tone === 'danger' ? 'text-danger' : 'text-accent'
        }`}
      >
        {action}
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
  const alertStatus = useSession((s) => s.alertStatus)
  const alertResponse = useSession((s) => s.alertResponse)
  const requestEmergency = useSession((s) => s.requestEmergency)
  const setRoute = useSession((s) => s.setRoute)
  const reset = useSession((s) => s.reset)

  const value = risk?.risk ?? 0
  const band = phase === 'alerted' || phase === 'alerting' ? 'high' : resultBand(value)

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-28 pt-24 sm:px-6 sm:pt-28">
      <div className="mb-8 flex justify-center">
        <ProgressDots />
      </div>

      <Banner band={band} risk={value} />

      {/* What actually happened on the alert path. */}
      {alertStatus !== 'none' && (
        <div
          className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-control)] border border-line bg-surface px-5 py-4"
          role="status"
        >
          <Icon
            name={alertStatus === 'sent' ? 'check' : alertStatus === 'failed' ? 'alert' : 'clock'}
            size={18}
            className={alertStatus === 'sent' ? 'text-ok' : alertStatus === 'failed' ? 'text-danger' : 'text-ink-3'}
          />
          <p className="font-medium">
            {alertStatus === 'sending' && 'Contacting the demo number…'}
            {alertStatus === 'sent' && 'Alert sent to the demo number.'}
            {alertStatus === 'failed' && 'The alert did not go through.'}
          </p>
          {alertResponse?.dryRun && <span className="label-micro rounded-full bg-sunken px-2.5 py-1 text-ink-2">Dry run · nothing sent</span>}
          {alertResponse?.error && <span className="text-[0.9375rem] text-danger">{alertResponse.error}</span>}
        </div>
      )}

      {/* A failed alert must never be quiet: say so plainly, keep Call 911 the biggest thing on screen, offer a retry. */}
      {alertStatus === 'failed' && (
        <div className="mt-4 rounded-[var(--radius-panel)] border-2 border-danger bg-danger-wash p-6" role="alert" data-testid="alert-failed">
          <p className="text-xl font-semibold text-danger">The text to your emergency contact did NOT go out.</p>
          <p className="mt-1.5 text-[1rem] text-ink-2">
            {alertResponse?.error ?? 'Something went wrong.'} If this is an emergency, do not wait: call 911 yourself.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button as="a" href="tel:911" tone="danger" size="xl" icon="phone">
              Call 911 now
            </Button>
            <Button tone="quiet" size="xl" icon="refresh" onClick={() => requestEmergency('user_request')}>
              Try sending the text again
            </Button>
          </div>
        </div>
      )}

      {/* Actions. The high band keeps them too: a cancelled countdown still needs a way to get help. */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <ActionCard
          icon="phone"
          tone="danger"
          title="Call 911"
          body="Ambulance now. Paramedics can start treatment before you reach hospital."
          action="Dial now"
          href="tel:911"
        />
        <ActionCard
          icon="user"
          title={band === 'low' ? 'Tell someone' : 'Contact someone close'}
          body="Send the alert to your emergency contact, with your location and what the checks found."
          action="Send the alert"
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
        <MicroLabel className="mb-4">What the checks measured</MicroLabel>
        <LazyBoundary what="The details" reset={Dashboard.reset}>
          <Dashboard />
        </LazyBoundary>
      </section>
    </div>
  )
}
