import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useFocusHeading } from '../../lib/a11y/useA11y'
import { SKIP_OFFER_MS } from '../../lib/config'
import { useMic } from '../../lib/media/micLevel'
import { useSession } from '../../lib/session/store'
import type { TestName } from '../../lib/contracts'
import { Button } from '../ui/Button'
import { Disclaimer } from '../ui/Disclaimer'
import { Icon } from '../ui/Icon'
import { ProgressDots } from './ProgressDots'
import { TranscriptStrip } from './TranscriptStrip'

/**
 * Offers a way out once the patient has been on a step for SKIP_OFFER_MS without finishing it, so a framing gate
 * that never passes can never trap them (storyboard: "if they don't pass the test, a skip button should pop up").
 * The timer restarts whenever `key` changes, i.e. on every new step.
 */
function useSkipOffer(key: string): boolean {
  // Storing WHICH step the offer belongs to (rather than a bare boolean) means a new step withdraws it by
  // comparison, with no state reset to write.
  const [offeredFor, setOfferedFor] = useState<string | null>(null)
  useEffect(() => {
    const id = setTimeout(() => setOfferedFor(key), SKIP_OFFER_MS)
    return () => clearTimeout(id)
  }, [key])
  return offeredFor === key
}

/** Shown on every test screen while the microphone is muted or silent — the assistant cannot hear anything. */
function MuteWarning() {
  const { verdict } = useMic()
  // Only warn about a microphone we actually hold. 'no-mic' means we never opened one, which the consent card
  // covers — claiming "I cannot hear you" there would be a false alarm.
  if (verdict.reason !== 'track-off' && verdict.reason !== 'no-sound') return null
  const text =
    verdict.reason === 'track-off'
      ? 'Your microphone is muted. Unmute it so the assistant can hear you.'
      : 'I cannot hear anything. Check that the right microphone is selected and unmuted.'
  return (
    <p
      className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-caution/30 bg-caution-wash px-4 py-3 text-[1rem] text-caution"
      role="alert"
    >
      <Icon name="micOff" size={18} className="mt-px shrink-0" />
      {text}
    </p>
  )
}

interface Props {
  test: TestName
  /** Big instruction, e.g. "Smile as wide as you can". */
  title: string
  /** One supporting line under the title. */
  lede?: string
  /** The stage: camera, waveform, whatever this check needs. */
  children: ReactNode
  /** Optional rail beside the stage (reference figures for the arm check). */
  rail?: ReactNode
  /** Rendered under the stage, above the transcript. */
  footer?: ReactNode
}

/**
 * Chrome shared by every check: progress dots, instruction, stage, transcript, mute warning and the skip hatch.
 * Layout is a single centred column, with an optional narrow rail on the left at desktop widths.
 */
export function TestScreen({ test, title, lede, children, rail, footer }: Props) {
  const skipTest = useSession((s) => s.skipTest)
  const offered = useSkipOffer(test)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useFocusHeading(headingRef)

  return (
    <div
      className={`mx-auto w-full max-w-6xl px-4 pt-24 sm:px-6 sm:pb-28 sm:pt-28 ${
        // While the skip card is up on a phone it floats over the bottom of the page; extra padding lets the
        // controls scroll clear of it instead of being trapped underneath.
        offered ? 'pb-56' : 'pb-28'
      }`}
    >
      <div className="mb-8 flex flex-col items-center gap-6">
        <ProgressDots />
        {/* Polite live region: when the instruction changes mid-check (relax -> smile, retry reasons) it is read out once.
            The heading itself takes focus when the screen first appears, which announces the first instruction. */}
        <div className="text-center" aria-live="polite" aria-atomic="true">
          <h1 ref={headingRef} tabIndex={-1} className="text-balance text-3xl font-semibold tracking-tight outline-none sm:text-4xl">
            {title}
          </h1>
          {lede && <p className="mx-auto mt-2 max-w-[48ch] text-pretty text-lg text-ink-2">{lede}</p>}
        </div>
      </div>

      <div className={rail ? 'grid gap-5 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]' : ''}>
        {rail && <div className="order-2 lg:order-1">{rail}</div>}
        <div className="order-1 min-w-0 lg:order-2">
          {children}
          {footer && <div className="mt-4">{footer}</div>}
          <div className="mt-4 space-y-3">
            <MuteWarning />
            <TranscriptStrip />
          </div>
          <Disclaimer variant="short" className="mt-4 text-center text-[0.875rem] leading-snug text-ink-3" />
        </div>
      </div>

      {/* The skip hatch is pinned to the bottom of the WINDOW, not the page: on a short laptop screen the page
          content runs below the fold, and a button down there is a button nobody finds. It appears in place
          rather than as a dialog, so it never steals focus mid-check. */}
      {offered && (
        // Bottom-RIGHT on wide screens: the centred controls (Start recording, the camera caption) stay clear, and the
        // Call 911 button owns the bottom-left. Full-width above that button on phones.
        <div
          className="fixed inset-x-4 bottom-24 z-30 sm:inset-x-auto sm:bottom-7 sm:right-7 sm:w-72"
          role="region"
          aria-live="polite"
          aria-label="Skip this check"
        >
          <div className="pop flex items-center justify-between gap-3 rounded-[var(--radius-panel)] border-2 border-accent bg-surface p-3 shadow-[var(--shadow-lift)] sm:block sm:p-4">
            <div>
              <p className="text-lg font-semibold leading-tight">
                Stuck<span className="hidden sm:inline"> on this one</span>?
              </p>
              <p className="mb-3 mt-0.5 hidden text-[0.9375rem] text-ink-2 sm:block">Skip it and keep going.</p>
            </div>
            <Button tone="accent" size="lg" className="sm:w-full" iconAfter="arrowRight" onClick={() => skipTest(test)}>
              Skip this check
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
