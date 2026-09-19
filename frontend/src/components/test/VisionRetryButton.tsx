import { useEffect, useState } from 'react'
import type { TestName, TestResult } from '../../lib/contracts'
import { useSession } from '../../lib/session/store'
import { eyeAdvice } from '../../lib/vision/eyeAdvice'
import { useCaptureProgress } from '../../lib/vision/progressStore'
import { isVisionScreenActive, runVisionWithOneRetry, showsRetryButton, VISION_STUCK_GRACE_MS, visionActionState } from '../../lib/vision/retry'
import { Button } from '../ui/Button'

interface Props {
  test: Extract<TestName, 'eyes' | 'face' | 'arms'>
  run: () => Promise<TestResult>
  /**
   * Eyes only: after a failed attempt (i.e. once the automatic retry has also failed) explain WHY in plain words and
   * offer "Continue without this check" next to Try again, so a check that cannot work here is never a dead end. The
   * skipped test is dropped from the risk score, never guessed.
   */
  skippable?: boolean
}

/**
 * The way out of every dead end on a vision check screen. Shown after a failed attempt ("Try again"), and ALSO when the
 * check has gone idle without any result for a moment (e.g. another test, such as one the voice agent started, cancelled
 * it), so a positioned patient can never be left on a screen with nothing to press.
 */
export function VisionRetryButton({ test, run, skippable = false }: Props) {
  const skipTest = useSession((s) => s.skipTest)
  const running = useCaptureProgress((s) => s.running)
  const retryPending = useCaptureProgress((s) => s.retryPending)
  const result = useSession((s) => s.results[test])

  const idle = running === null && retryPending === null && !result
  const [graceElapsed, setGraceElapsed] = useState(false)
  useEffect(() => {
    if (!idle) return
    const id = setTimeout(() => setGraceElapsed(true), VISION_STUCK_GRACE_MS)
    return () => {
      clearTimeout(id)
      setGraceElapsed(false) // reset in cleanup (not in the effect body) whenever the check stops being idle
    }
  }, [idle])

  // `idle &&` keeps a stale `true` from showing the button for a frame after a new run starts.
  if (!showsRetryButton(visionActionState({ running, retryPending, result, idleGraceElapsed: idle && graceElapsed }))) return null

  const advice = skippable && result?.needsRetry ? eyeAdvice(result.flags[0]) : null
  return (
    <div className="flex flex-col items-center gap-3" data-testid="vision-retry">
      {advice && (
        <div className="max-w-[48ch] text-center" role="status">
          <p className="text-lg font-semibold">{advice.headline}</p>
          {advice.tips.length > 0 && <p className="mt-1 text-[1rem] text-ink-2">{advice.tips.join(' ')}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button icon="refresh" onClick={() => void runVisionWithOneRetry(run, () => isVisionScreenActive(test))}>
          Try again
        </Button>
        {skippable && (
          <Button tone="quiet" icon="skip" onClick={() => skipTest(test)}>
            Continue without this check
          </Button>
        )}
      </div>
    </div>
  )
}
