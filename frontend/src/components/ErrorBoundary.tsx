import { Component, type ErrorInfo, type ReactNode } from 'react'
import { clearAllLocalData } from '../lib/privacy/clearData'
import { isChunkLoadError, recordError } from '../lib/resilience/errorLog'
import { startOver, stopHardware } from '../lib/resilience/recovery'
import { getLocale, pick, type Locale } from '../lib/i18n'

interface Props {
  children: ReactNode
  /** Small inline fallback instead of the full-page crash screen (used around lazy-loaded pieces). */
  inline?: ReactNode
  /** Changing this value clears a previous error (e.g. the route). */
  resetKey?: string
}

interface State {
  error: unknown
  hasError: boolean
  resetKey?: string
}

/**
 * The last line of defence against a white screen. A render error anywhere below lands here, the camera and microphone
 * are switched off, and the visitor gets three ways forward plus a Call 911 link that never depends on app state.
 * Deliberately plain markup (no store reads, no icons): the fallback must not be able to crash for the same reason.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, hasError: false, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error, hasError: true }
  }

  // A new resetKey (e.g. the route changed) clears an old error, so one broken page does not poison the next.
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.resetKey) return null
    return { resetKey: props.resetKey, error: null, hasError: false }
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    recordError('boundary', error)
    // A full crash switches the camera and microphone off; a failed lazy piece (inline fallback) must not touch a check.
    if (this.props.inline === undefined) stopHardware()
  }

  private recover = (): void => this.setState({ error: null, hasError: false })

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children
    if (this.props.inline !== undefined) return this.props.inline
    const chunk = isChunkLoadError(this.state.error)
    return (
      <CrashScreen
        chunk={chunk}
        locale={getLocale()}
        onStartOver={() => {
          startOver()
          this.recover()
        }}
        onClear={() => {
          void clearAllLocalData().finally(() => this.recover())
        }}
      />
    )
  }
}

const btn =
  'inline-flex min-h-12 items-center justify-center rounded-full border border-line-strong bg-surface px-6 text-[1rem] font-semibold text-ink hover:bg-sunken'

export function CrashScreen({ chunk, onStartOver, onClear, locale = 'en' }: { chunk: boolean; onStartOver: () => void; onClear: () => void; locale?: Locale }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-paper p-6 text-center text-ink" role="alert" data-testid="crash-screen">
      <h1 className="text-balance text-3xl font-semibold tracking-tight">{pick(locale, 'Something went wrong on our side', 'Algo sali\u00f3 mal de nuestro lado')}</h1>
      <p className="mt-3 max-w-[46ch] text-pretty text-lg text-ink-2">
        {chunk
          ? pick(locale, 'A part of the page could not load, probably a dropped connection. Check the connection, then reload.', 'Una parte de la p\u00e1gina no pudo cargarse, probablemente por una interrupci\u00f3n de la conexi\u00f3n. Revisa la conexi\u00f3n y recarga la p\u00e1gina.')
          : pick(locale, 'The camera and microphone have been switched off. Nothing was sent anywhere. Pick one of these to carry on.', 'La c\u00e1mara y el micr\u00f3fono se apagaron. No se envi\u00f3 nada. Elige una opci\u00f3n para continuar.')}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button type="button" className={`${btn} !bg-ink !text-white hover:!opacity-90`} onClick={() => window.location.reload()}>
          {pick(locale, 'Reload the page', 'Recargar la p\u00e1gina')}
        </button>
        <button type="button" className={btn} onClick={onStartOver}>
          {pick(locale, 'Start over', 'Empezar de nuevo')}
        </button>
        <button type="button" className={btn} onClick={onClear}>
          {pick(locale, 'Clear my data', 'Borrar mis datos')}
        </button>
      </div>
      <p className="mt-8 max-w-[46ch] text-[0.9375rem] text-ink-3">
        {pick(locale, 'This is only a BE-FAST guide, not a medical device. If you think someone is having a stroke, do not wait for this page.', 'Esto es solo una gu\u00eda BE-FAST, no un dispositivo m\u00e9dico. Si crees que alguien est\u00e1 sufriendo un derrame cerebral, no esperes a esta p\u00e1gina.')}
      </p>
      {/* Not `position: fixed`-dependent: always the biggest, reddest thing on the screen. */}
      <a
        href="tel:911"
        className="mt-4 inline-flex min-h-14 items-center justify-center rounded-full bg-danger px-8 text-xl font-semibold text-white hover:bg-danger-press"
      >
        {pick(locale, 'Call 911', 'Llama al 911')}
      </a>
    </div>
  )
}
