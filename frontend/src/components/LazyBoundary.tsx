import { Suspense, useState, type ReactNode } from 'react'
import { ErrorBoundary } from './ErrorBoundary'

/** A calm placeholder while a lazy chunk downloads. Never blank: the patient always sees that something is happening. */
export function ChunkLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center p-8 text-lg text-ink-3" role="status">
      {label}
    </div>
  )
}

/** Shown when a lazy chunk could not be fetched (dropped wifi, stale deploy). Retry remounts and asks again. */
function ChunkFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8 text-center" role="alert" data-testid="chunk-failed">
      <p className="max-w-[40ch] text-lg text-ink-2">{what} could not load. Check your connection.</p>
      <div className="flex gap-3">
        <button type="button" onClick={onRetry} className="min-h-11 rounded-full bg-ink px-5 font-semibold text-white hover:opacity-90">
          Try again
        </button>
        <button type="button" onClick={() => window.location.reload()} className="min-h-11 rounded-full border border-line-strong bg-surface px-5 font-semibold hover:bg-sunken">
          Reload the page
        </button>
      </div>
    </div>
  )
}

/**
 * Suspense + a LOCAL error boundary for one lazy piece: a failed download degrades that piece (message + retry, or
 * `failed` when given, e.g. nothing at all for an optional widget) and never takes the whole app to the crash screen.
 * `attempt` changes the boundary key on retry so React re-runs the import.
 */
export function LazyBoundary({
  children,
  what,
  fallback,
  failed,
  reset,
}: {
  children: ReactNode
  what: string
  fallback?: ReactNode
  failed?: ReactNode
  /** `lazyChunk(...).reset`, so a retry really re-downloads. */
  reset?: () => void
}) {
  const [attempt, setAttempt] = useState(0)
  const retry = () => {
    reset?.()
    setAttempt((n) => n + 1)
  }
  return (
    <ErrorBoundary key={attempt} inline={failed ?? <ChunkFailed what={what} onRetry={retry} />}>
      <Suspense fallback={fallback ?? <ChunkLoading />}>{children}</Suspense>
    </ErrorBoundary>
  )
}
