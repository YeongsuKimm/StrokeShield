// Speech calibration recording (`?record=1`). After each completed speech run the WAV and a sidecar JSON are saved with
// matching base names and (optionally) downloaded. Subject / notes / auto-download come from the shared calibration
// recorder store (read only; RecordPanel edits them). No effect unless `?record=1`.
import { create } from 'zustand'
import { SPEECH_TARGET_PHRASE } from '../config'
import type { TestResult } from '../contracts'
import { isRecordSearch, useRecorder } from '../calibration/recorder'
import type { SpeechRecording } from './recorder'
import { buildSidecar, speechBaseName, SPEECH_SCENARIOS } from './speechScenarios'

export interface SavedSpeechRun {
  id: string
  baseName: string
  scenario: string
  severity: number
  needsRetry: boolean
  durationS: number
  wav: Blob
  json: string
}

interface SpeechRecorderState {
  scenario: string
  runs: SavedSpeechRun[]
  setScenario: (id: string) => void
  add: (run: SavedSpeechRun) => void
  clear: () => void
}

export const useSpeechRecorder = create<SpeechRecorderState>((set) => ({
  scenario: SPEECH_SCENARIOS[0].id,
  runs: [],
  setScenario: (scenario) => set({ scenario }),
  add: (run) => set((s) => ({ runs: [run, ...s.runs] })),
  clear: () => set({ runs: [] }),
}))

function downloadBlob(fileName: string, blob: Blob): void {
  if (typeof document === 'undefined') return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Download the .wav and the .json of a saved run (two files with the same base name). */
export function downloadSpeechRun(run: SavedSpeechRun): void {
  downloadBlob(`${run.baseName}.wav`, run.wav)
  // Some browsers throttle back-to-back downloads; a short gap keeps both.
  setTimeout(() => downloadBlob(`${run.baseName}.json`, new Blob([run.json], { type: 'application/json' })), 250)
}

/** Called by the speech runner after a clip with speech was analyzed. Never throws; does nothing unless `?record=1`. */
export function recordSpeechRun(rec: SpeechRecording, liveResult: TestResult): void {
  if (!isRecordSearch(globalThis.location?.search ?? '')) return
  try {
    const shared = useRecorder.getState()
    const st = useSpeechRecorder.getState()
    const createdAt = new Date().toISOString()
    const sidecar = buildSidecar({
      subject: shared.subject,
      scenarioId: st.scenario,
      notes: shared.notes,
      targetPhrase: SPEECH_TARGET_PHRASE,
      durationS: rec.durationS,
      sampleRate: rec.sampleRate,
      createdAt,
      liveResult,
    })
    const baseName = speechBaseName(sidecar.subject, sidecar.scenario, createdAt)
    const run: SavedSpeechRun = {
      id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
      baseName,
      scenario: sidecar.scenario,
      severity: liveResult.severity,
      needsRetry: !!liveResult.needsRetry,
      durationS: sidecar.durationS,
      wav: rec.wav,
      json: JSON.stringify(sidecar, null, 2),
    }
    st.add(run)
    if (shared.autoDownload) downloadSpeechRun(run)
  } catch (e) {
    console.warn('[record] failed to save speech recording', e)
  }
}
