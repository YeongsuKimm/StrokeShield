// Tiny UI store for the speech test (level meter, stage, retry hint). Written by speechRunner; read by SpeechPanel.
import { create } from 'zustand'

export type SpeechStage = 'idle' | 'listening' | 'analyzing'

export interface SpeechProgress {
  stage: SpeechStage
  /** Live mic level, RMS 0..1 (0 when not listening). */
  level: number
  /** True once the first audio chunk of this take arrived (the mic is really open); false while it is still opening. */
  heard?: boolean
  /** Spoken-style retry hint from the last run (cleared when a new run starts). */
  hint?: string
}

interface SpeechUiState extends SpeechProgress {
  running: boolean
  set: (p: Partial<SpeechProgress> & { running?: boolean }) => void
  reset: () => void
}

export const useSpeechProgress = create<SpeechUiState>((set) => ({
  running: false,
  stage: 'idle',
  level: 0,
  hint: undefined,
  set: (p) => set(p),
  reset: () => set({ running: false, stage: 'idle', level: 0 }),
}))
