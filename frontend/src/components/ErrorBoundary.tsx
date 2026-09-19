import { Component, type ErrorInfo, type ReactNode } from 'react'
import { clearAllLocalData } from '../lib/privacy/clearData'
import { isChunkLoadError, recordError } from '../lib/resilience/errorLog'
import { startOver, stopHardware } from '../lib/resilience/recovery'

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

export function CrashScreen({ chunk, onStartOver, onClear }: { chunk: boolean; onStartOver: () => void; onClear: () => void }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-paper p-6 text-center text-ink" role="alert" data-testid="crash-screen">
      <h1 className="text-balance text-3xl font-semibold tracking-tight">Something went wrong on our side</h1>
      <p className="mt-3 max-w-[46ch] text-pretty text-lg text-ink-2">
        {chunk
          ? 'A part of the page could not load, probably a dropped connection. Check the connection, then reload.'
          : 'The camera and microphone have been switched off. Nothing was sent anywhere. Pick one of these to carry on.'}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button type="button" className={`${btn} !bg-ink !text-white hover:!opacity-90`} onClick={() => window.location.reload()}>
          Reload the page
        </button>
        <button type="button" className={btn} onClick={onStartOver}>
          Start over
        </button>
        <button type="button" className={btn} onClick={onClear}>
          Clear my data
        </button>
      </div>
      <p className="mt-8 max-w-[46ch] text-[0.9375rem] text-ink-3">
        This is only a BE-FAST guide, not a medical device. If you think someone is having a stroke, do not wait for this page.
      </p>
      {/* Not `position: fixed`-dependent: always the biggest, reddest thing on the screen. */}
      <a
        href="tel:911"
        className="mt-4 inline-flex min-h-14 items-center justify-center rounded-full bg-danger px-8 text-xl font-semibold text-white hover:bg-danger-press"
      >
        Call 911
      </a>
    </div>
  )
}
