import type { TestName, TestResult } from '../../lib/contracts'
import { useSession } from '../../lib/session/store'
import { useCaptureProgress } from '../../lib/vision/progressStore'
import { runVisionWithOneRetry } from '../../lib/vision/retry'
import { Button } from '../ui/Button'

interface Props {
  test: Extract<TestName, 'eyes' | 'face' | 'arms'>
  run: () => Promise<TestResult>
}

export function VisionRetryButton({ test, run }: Props) {
  const running = useCaptureProgress((s) => s.running)
  const failed = useSession((s) => s.results[test]?.needsRetry === true)
  if (!failed || running !== null) return null

  return (
    <div className="flex justify-center">
      <Button icon="refresh" onClick={() => void runVisionWithOneRetry(run, () => useSession.getState().phase === test)}>
        Try again
      </Button>
    </div>
  )
}
