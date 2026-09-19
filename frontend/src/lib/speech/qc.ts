// Client-side capture quality gate (pure). Unusable audio is never sent to the backend.
import { SPEECH_QC } from './config'
import { clippingFraction, peak } from './wav'

export type LevelVerdict = 'ok' | 'too-quiet' | 'too-loud'

export interface SpeechQc {
  peak: number
  clipping: number
  level: LevelVerdict
  speechDetected: boolean
}

export function assessLevel(peakValue: number, clipping: number): LevelVerdict {
  if (clipping >= SPEECH_QC.maxClipping) return 'too-loud'
  if (peakValue < SPEECH_QC.minPeak) return 'too-quiet'
  return 'ok'
}

export function assessQc(samples: Float32Array, speechDetected: boolean): SpeechQc {
  const p = peak(samples)
  const clipping = clippingFraction(samples, SPEECH_QC.clipLevel)
  return { peak: p, clipping, level: assessLevel(p, clipping), speechDetected }
}
