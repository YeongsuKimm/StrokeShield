import { useEffect, useState } from 'react'
import type { TestName, TestResult } from '../../lib/contracts'
import { useSession } from '../../lib/session/store'
import { useCaptureProgress } from '../../lib/vision/progressStore'
import { isVisionScreenActive, runVisionWithOneRetry, showsRetryButton, VISION_STUCK_GRACE_MS, visionActionState } from '../../lib/vision/retry'
import { Button } from '../ui/Button'

interface Props {
  test: Extract<TestName, 'eyes' | 'face' | 'arms'>
  run: () => Promise<TestResult>
}

/**
 * The way out of every dead end on a vision check screen. Shown after a failed attempt ("Try again"), and ALSO when the
 * check has gone idle without any result for a moment (e.g. another test, such as one the voice agent started, cancelled
 * it), so a positioned patient can never be left on a screen with nothing to press.
 */
export function VisionRetryButton({ test, run }: Props) {
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

  return (
    <div className="flex justify-center">
      <Button icon="refresh" onClick={() => void runVisionWithOneRetry(run, () => isVisionScreenActive(test))}>
        Try again
      </Button>
    </div>
  )
}
