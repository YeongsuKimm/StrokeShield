import { resultBand, type ResultBand } from '../../lib/config'
import { useSession } from '../../lib/session/store'
import { Dashboard } from '../Dashboard'
import { ProgressDots } from '../test/ProgressDots'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { MicroLabel } from '../ui/Primitives'

const DISCLAIMER = 'Not medical advice. StrokeShield is a demo and has not been clinically validated.'

/** Nearby emergency departments, via a plain maps search — no API key, works offline-of-our-backend. */
const HOSPITAL_SEARCH = 'https://www.google.com/maps/search/emergency+room+near+me'

function Banner({ band, risk }: { band: ResultBand; risk: number }) {
  const copy = {
    high: {
      tone: 'bg-danger text-white',
      label: 'Signs that need urgent attention',
      body: 'Several checks came back abnormal. Treat this as an emergency until a clinician says otherwise.',
    },
    caution: {
      tone: 'bg-caution text-white',
      label: 'Something showed up',
      body: 'Not enough to raise the alarm on its own, but enough that it is worth getting looked at — especially if this is new.',
    },
    low: {
      tone: 'bg-ok text-white',
      label: 'Low risk detected',
      body: 'Nothing in these checks looked abnormal. If symptoms start or get worse, do the check again or call for help.',
    },
  }[band]

  return (
    <div className={`rounded-[var(--radius-panel)] p-8 sm:p-10 ${copy.tone}`}>
      <div className="flex items-center gap-2 text-white/85">
        <Icon name={band === 'low' ? 'check' : 'alert'} size={17} />
        <span className="label-micro">Result</span>
      </div>
      <h1 className="mt-3 text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{copy.label}</h1>
      <p className="mt-4 max-w-[52ch] text-pretty text-lg leading-relaxed text-white/90">{copy.body}</p>
      <p className="tnum mt-6 text-[0.9375rem] text-white/85">
        Combined risk {Math.round(risk * 100)}% · {DISCLAIMER}
      </p>
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

      <section className="mt-14">
        <MicroLabel className="mb-4">What the checks measured</MicroLabel>
        <Dashboard />
      </section>
    </div>
  )
}
