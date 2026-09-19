import { testSequence } from '../../lib/config'
import { useSession } from '../../lib/session/store'
import type { TestName } from '../../lib/contracts'

const LABEL: Record<TestName, string> = { speech: 'Speech', eyes: 'Eyes', face: 'Face', arms: 'Arms' }

type StepState = 'done' | 'current' | 'skipped' | 'todo'

const STATE_WORDS: Record<StepState, string> = { done: 'done', current: 'you are here', skipped: 'skipped', todo: 'still to do' }

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

  // A real list: screen readers get "list, 5 items", each with its name and state in words. The shapes differ too, so
  // state never rests on colour alone: current = long pill, done = filled dot, skipped = filled diamond, to do = hollow ring.
  return (
    <ol
      className="flex items-center justify-center gap-2 sm:gap-3"
      aria-label={`Progress: step ${currentIndex + 1} of ${steps.length}`}
    >
      {steps.map((s) => (
        <li key={s.key} className="group flex items-center gap-2" aria-current={s.state === 'current' ? 'step' : undefined}>
          <span
            className={`block transition-all duration-300 ease-out forced-colors:bg-[CanvasText] ${
              s.state === 'current'
                ? 'h-2.5 w-8 rounded-full bg-accent'
                : s.state === 'done'
                  ? 'size-2.5 rounded-full bg-accent'
                  : s.state === 'skipped'
                    ? 'size-2.5 rotate-45 bg-ink-3'
                    : 'size-2.5 rounded-full ring-2 ring-inset ring-ink-3'
            }`}
            aria-hidden
          />
          <span className="sr-only">{`${s.label}: ${STATE_WORDS[s.state]}`}</span>
          <span className={`label-micro hidden sm:inline ${s.state === 'current' ? 'text-accent' : 'text-ink-3'}`} aria-hidden>
            {s.state === 'current' ? s.label : ''}
          </span>
        </li>
      ))}
    </ol>
  )
}
