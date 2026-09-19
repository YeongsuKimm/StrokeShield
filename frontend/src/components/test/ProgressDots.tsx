import { testSequence } from '../../lib/config'
import { useSession } from '../../lib/session/store'
import type { TestName } from '../../lib/contracts'

const LABEL: Record<TestName, string> = { speech: 'Speech', eyes: 'Eyes', face: 'Face', arms: 'Arms' }

type StepState = 'done' | 'current' | 'skipped' | 'todo'

/**
 * The storyboard's row of dots: one per check plus the verdict. Shown on every screen except the home hero and the
 * info document. Purely a status display — it is not a navigation control, since the order is fixed.
 */
export function ProgressDots() {
  const phase = useSession((s) => s.phase)
  const results = useSession((s) => s.results)
  const skipped = useSession((s) => s.skipped)
  const sequence = testSequence()

  const stateOf = (t: TestName): StepState => {
    if (skipped.includes(t)) return 'skipped'
    if (phase === t) return 'current'
    if (results[t] && !results[t]?.needsRetry) return 'done'
    return 'todo'
  }

  const resultState: StepState = ['scoring', 'clear', 'countdown', 'alerting', 'alerted', 'cancelled'].includes(phase)
    ? 'current'
    : 'todo'

  const steps: { key: string; label: string; state: StepState }[] = [
    ...sequence.map((t) => ({ key: t, label: LABEL[t], state: stateOf(t) })),
    { key: 'result', label: 'Result', state: resultState },
  ]

  const currentIndex = steps.findIndex((s) => s.state === 'current')

  return (
    <div
      className="flex items-center justify-center gap-2 sm:gap-3"
      role="group"
      aria-label={`Step ${currentIndex + 1} of ${steps.length}: ${steps[currentIndex]?.label ?? ''}`}
    >
      {steps.map((s) => (
        <div key={s.key} className="group flex items-center gap-2">
          <span
            className={`block rounded-full transition-all duration-300 ease-out ${
              s.state === 'current'
                ? 'h-2.5 w-8 bg-accent'
                : s.state === 'done'
                  ? 'size-2.5 bg-accent'
                  : s.state === 'skipped'
                    ? 'size-2.5 bg-line-strong ring-2 ring-line'
                    : 'size-2.5 bg-line-strong'
            }`}
            aria-hidden
          />
          <span className={`label-micro hidden sm:inline ${s.state === 'current' ? 'text-accent' : 'text-ink-3'}`}>
            {s.state === 'current' ? s.label : ''}
          </span>
        </div>
      ))}
    </div>
  )
}
