import { useRef, type RefObject } from 'react'
import { useFocusHeading } from '../../lib/a11y/useA11y'
import { resultBand, type ResultBand } from '../../lib/config'
import { RESULT_BAND_COPY } from '../../lib/copy/features'
import { isDemoNothingSent } from '../../lib/alertFailure'
import { useSession } from '../../lib/session/store'
import { lazyChunk } from '../../lib/resilience/lazyChunk'
import { LazyBoundary } from '../LazyBoundary'
import { AlertPreview } from './AlertPreview'
import { AlertStatus } from './AlertStatus'
import { CopySummary } from './CopySummary'
import { MeasuredPanel } from './MeasuredPanel'
import { ClearDataButton } from '../pages/ClearDataButton'
import { ProgressDots } from '../test/ProgressDots'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Disclaimer } from '../ui/Disclaimer'
import { MicroLabel } from '../ui/Primitives'
import { pick, useLocale } from '../../lib/i18n'

// The detail dashboard is below the fold and never needed to act: it loads after the verdict and Call 911 are on screen.
const Dashboard = lazyChunk(() => import('../Dashboard').then((m) => ({ default: m.Dashboard })))

/** Nearby emergency departments, via a plain maps search — no API key, works offline-of-our-backend. */
const HOSPITAL_SEARCH = 'https://www.google.com/maps/search/emergency+room+near+me'

function Banner({ band, risk, headingRef }: { band: ResultBand; risk: number; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const locale = useLocale((s) => s.locale)
  const spanish = {
    high: { label: 'Las revisiones marcaron posibles signos', body: 'Una o m\u00e1s revisiones dieron un resultado anormal. No es un diagn\u00f3stico, pero tr\u00e1talo como una emergencia: llama al 911 ahora.' },
    caution: { label: 'Una revisi\u00f3n fue dudosa', body: 'Esta herramienta no puede decir qu\u00e9 significa. Si es algo nuevo o te preocupa, llama al 911 o busca atenci\u00f3n inmediatamente.' },
    low: { label: 'Estas revisiones no marcaron nada', body: 'Eso no significa que no haya un derrame cerebral: estas revisiones no pueden descartarlo. Si tienes s\u00edntomas o aparecen o cambian, llama al 911 de inmediato.' },
  }
  const copy = {
    ...(locale === 'es' ? spanish[band] : RESULT_BAND_COPY[band]),
    tone: { high: 'bg-danger text-white', caution: 'bg-caution text-white', low: 'bg-ink text-white' /* neutral, not green: green could reassure someone who then delays care */ }[band],
  }

  return (
    <div className={`rounded-[var(--radius-panel)] p-8 sm:p-10 ${copy.tone}`}>
      <div className="flex items-center gap-2 text-white/85">
        <Icon name="alert" size={17} />
        <span className="label-micro">{pick(locale, 'Result', 'Resultado')}</span>
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
      <p className="tnum mt-6 text-[0.9375rem] text-white/85">{pick(locale, `Combined check score ${Math.round(risk * 100)}% (uncalibrated)`, `Puntaje combinado ${Math.round(risk * 100)}% (sin calibrar)`)}</p>
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
      <span className={tone === 'danger' ? 'text-danger' : 'text-accent'}>
        <Icon name={icon} size={22} />
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
  const locale = useLocale((s) => s.locale)
  const risk = useSession((s) => s.risk)
  const phase = useSession((s) => s.phase)
  const requestEmergency = useSession((s) => s.requestEmergency)
  const setRoute = useSession((s) => s.setRoute)
  const reset = useSession((s) => s.reset)
  const alertStatus = useSession((s) => s.alertStatus)
  const alertResponse = useSession((s) => s.alertResponse)
  const demoEnabled = useSession((s) => s.demoEnabled)
  const hasLocation = useSession((s) => !!s.location)

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
      {alertStatus === 'failed' && <AlertPreview stage="failed" className="mt-3" />}
      {alertStatus === 'sent' && <AlertPreview stage={isDemoNothingSent(alertResponse) ? 'demoSent' : 'sent'} className="mt-3" />}

      {/* Actions. The high band keeps them too: a cancelled countdown still needs a way to get help. */}
      <div className="mt-6 grid gap-4 sm:grid-cols-[1.35fr_1fr_1fr]">
        <ActionCard
          icon="phone"
          tone="danger"
          title={pick(locale, 'Call 911', 'Llama al 911')}
          body={pick(locale, 'Ambulance now. Paramedics can start treatment before you reach the hospital.', 'Pide una ambulancia ahora. Los param\u00e9dicos pueden empezar el tratamiento antes de llegar al hospital.')}
          action={pick(locale, 'Dial now', 'Llamar ahora')}
          href="tel:911"
        />
        <ActionCard
          icon="user"
          title={pick(locale, demoEnabled ? 'Demo: send the text anyway' : 'Text the demo contact', demoEnabled ? 'Demo: enviar el mensaje de todos modos' : 'Escribir al contacto de demo')}
          body={pick(
            locale,
            demoEnabled
              ? `Send to the configured demo phone regardless of this result. ${hasLocation ? 'Your allowed location will be included.' : 'Location will be included if it was allowed.'} It does not reach emergency services.`
              : 'Send a text to the demo phone we set up ahead of time, with your location if you allowed it and what the checks found. It does not reach emergency services.',
            demoEnabled
              ? `Env\u00eda al tel\u00e9fono de demo configurado sin importar este resultado. ${hasLocation ? 'Se incluir\u00e1 tu ubicaci\u00f3n autorizada.' : 'La ubicaci\u00f3n se incluir\u00e1 si la autorizaste.'} No contacta a emergencias.`
              : 'Env\u00eda un mensaje al tel\u00e9fono de demo configurado, con tu ubicaci\u00f3n si la autorizaste y lo que encontraron las revisiones. No contacta a emergencias.',
          )}
          action={pick(locale, demoEnabled ? 'Send demo text' : 'Send the text', demoEnabled ? 'Enviar mensaje de demo' : 'Enviar mensaje')}
          onClick={() => requestEmergency('user_request')}
        />
        <ActionCard
          icon="hospital"
          title={pick(locale, 'Emergency rooms nearby', 'Salas de emergencia cercanas')}
          body={pick(locale, 'Find the closest emergency department. Do not drive yourself.', 'Encuentra el servicio de urgencias m\u00e1s cercano. No conduzcas t\u00fa.')}
          action={pick(locale, 'Open the map', 'Abrir el mapa')}
          href={HOSPITAL_SEARCH}
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button tone="quiet" icon="arrowUpRight" onClick={() => setRoute('info')}>
          {pick(locale, 'Stroke resources and hotlines', 'Recursos y l\u00edneas de ayuda')}
        </Button>
        <Button tone="quiet" icon="refresh" onClick={reset}>
          {pick(locale, 'Run the check again', 'Repetir la revisi\u00f3n')}
        </Button>
        <CopySummary band={band} />
      </div>
      <ClearDataButton className="mt-4" />

      <section className="mt-14">
        <MicroLabel level={2} className="mb-4">
          {pick(locale, 'What the checks measured', 'Lo que midieron las revisiones')}
        </MicroLabel>
        <MeasuredPanel />
        <LazyBoundary what="The details" reset={Dashboard.reset}>
          <Dashboard />
        </LazyBoundary>
      </section>
    </div>
  )
}
