// Turns a raw microphone RMS (0..1) into a 0..1 bar height for the level meter. Pure, so it can be unit-tested.
//
// Why decibels: the speech recorder captures the RAW signal (echo cancellation, noise suppression and auto-gain are
// deliberately OFF so the acoustic analysis is not distorted), which makes real microphones come out QUIET: ordinary
// speech is often an RMS of 0.005-0.03. A linear scale put that at 1-10 % of the bar, i.e. a wave that looked dead
// even though the recorder was hearing you fine. Perception of loudness is logarithmic, so the meter maps
// FLOOR_DB..CEIL_DB (dBFS) onto 0..1.
const FLOOR_DB = -62 // below this reads as silence (a quiet room's noise floor)
const CEIL_DB = -20 // at or above this the bar is full (loud, close speech)

export function rmsToBar(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0
  const db = 20 * Math.log10(rms)
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / (CEIL_DB - FLOOR_DB)))
}
