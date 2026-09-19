// Tiny UI store for the running capture (captions, ring, framing outline). Written by useTestRunner at <= 5 Hz.
import { create } from 'zustand'
import type { CaptureProgress } from './capture'

export type RunnableTest = 'face' | 'arms' | 'eyes'

interface CaptureUiState {
  /** Which test is running right now (null when idle). */
  running: RunnableTest | null
  /** The first attempt failed and its correction is being shown before the one automatic retry. */
  retryPending: RunnableTest | null
  progress: CaptureProgress | null
  set: (running: RunnableTest | null, progress: CaptureProgress | null) => void
  setRetryPending: (test: RunnableTest | null) => void
}

export const useCaptureProgress = create<CaptureUiState>((set) => ({
  running: null,
  retryPending: null,
  progress: null,
  set: (running, progress) => set({ running, progress }),
  setRetryPending: (retryPending) => set({ retryPending }),
}))
