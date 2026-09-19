// Live recording (enable with `?record=1`): every completed face/arms run is saved as a Recording (see recording.ts) and
// downloaded as a .json file, labelled with who/what scenario you selected in RecordPanel. No effect unless enabled.
import { create } from 'zustand'
import type { TestResult } from '../contracts'
import { getVisionEngine } from '../vision/useMediaPipe'
import { browserEnvSources, collectEnv, conditionsFor } from './deviceProfile'
import { findScenario, recordingFileName, sanitizeConditions, scenariosFor, serializeRecording, type Conditions, type Recording, type RecordingEnv, type RecordingInputs, type RecordingKind } from './recording'

export const isRecordSearch = (search: string): boolean => new URLSearchParams(search).get('record') === '1'

export interface SavedRun {
  id: string
  fileName: string
  kind: RecordingKind
  scenario: string
  severity: number
  needsRetry: boolean
  sizeKB: number
  json: string
}

interface RecorderState {
  enabled: boolean
  subject: string
  notes: string
  autoDownload: boolean
  /** Selected scenario id per kind. */
  scenarioByKind: Record<RecordingKind, string>
  /** Structured conditions typed in the panels (vision + speech keys); remembered in localStorage like the subject. */
  conditions: Conditions
  runs: SavedRun[]
  setEnabled: (v: boolean) => void
  setSubject: (v: string) => void
  setNotes: (v: string) => void
  setAutoDownload: (v: boolean) => void
  setScenario: (kind: RecordingKind, id: string) => void
  setConditions: (patch: Conditions) => void
  add: (run: SavedRun) => void
  clear: () => void
}

const SUBJECT_KEY = 'strokeshield.record.subject'
const CONDITIONS_KEY = 'strokeshield.record.conditions'
const safeGet = (k: string): string => {
  try {
    return globalThis.localStorage?.getItem(k) ?? ''
  } catch {
    return ''
  }
}
const safeSet = (k: string, v: string): void => {
  try {
    globalThis.localStorage?.setItem(k, v)
  } catch {
    /* private mode / blocked storage: the field just won't be remembered */
  }
}

const loadConditions = (): Conditions => {
  try {
    return sanitizeConditions(JSON.parse(safeGet(CONDITIONS_KEY) || 'null')) ?? {}
  } catch {
    return {}
  }
}

export const useRecorder = create<RecorderState>((set) => ({
  enabled: isRecordSearch(globalThis.location?.search ?? ''),
  subject: safeGet(SUBJECT_KEY),
  notes: '',
  autoDownload: true,
  scenarioByKind: { face: scenariosFor('face')[0]?.id ?? '', arms: scenariosFor('arms')[0]?.id ?? '', eyes: scenariosFor('eyes')[0]?.id ?? '' },
  conditions: loadConditions(),
  runs: [],
  setEnabled: (enabled) => set({ enabled }),
  setSubject: (subject) => {
    safeSet(SUBJECT_KEY, subject)
    set({ subject })
  },
  setNotes: (notes) => set({ notes }),
  setAutoDownload: (autoDownload) => set({ autoDownload }),
  setScenario: (kind, id) => set((s) => ({ scenarioByKind: { ...s.scenarioByKind, [kind]: id } })),
  setConditions: (patch) =>
    set((s) => {
      const conditions = { ...s.conditions, ...patch }
      safeSet(CONDITIONS_KEY, JSON.stringify(conditions))
      return { conditions }
    }),
  add: (run) => set((s) => ({ runs: [run, ...s.runs] })),
  clear: () => set({ runs: [] }),
}))

/** Trigger a browser download of a JSON string. No-op outside a browser. */
export function downloadJson(fileName: string, json: string): void {
  if (typeof document === 'undefined') return
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Device/browser info for a vision recording; the delegate/fps/video size come from the live vision engine (best effort). */
export function collectVisionEnv(): RecordingEnv {
  let vision
  try {
    vision = getVisionEngine().summary
  } catch {
    /* engine unavailable (tests, no DOM): leave the vision fields null */
  }
  return collectEnv(browserEnvSources(vision))
}

/**
 * Called by the test runner right after an analyzer ran, with the exact inputs it got. Never throws (recording must not
 * break a real test run) and does nothing unless `?record=1`. `env` is injectable for tests.
 */
export function recordRun(inputs: RecordingInputs, liveResult: TestResult, env: () => RecordingEnv = collectVisionEnv): void {
  const st = useRecorder.getState()
  if (!st.enabled) return
  try {
    const scenario = findScenario(st.scenarioByKind[inputs.kind])
    const createdAt = new Date().toISOString()
    const rec: Recording = {
      schema: 1,
      id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt,
      subject: st.subject.trim() || 'anon',
      scenario: scenario?.id ?? 'unlabeled',
      expected: scenario?.expected ?? 'healthy',
      expectedSide: scenario?.side ?? 'none',
      notes: st.notes,
      conditions: conditionsFor('vision', st.conditions),
      env: env(),
      inputs,
      liveResult,
    }
    const json = serializeRecording(rec)
    const fileName = recordingFileName(rec)
    st.add({ id: rec.id, fileName, kind: inputs.kind, scenario: rec.scenario, severity: liveResult.severity, needsRetry: !!liveResult.needsRetry, sizeKB: Math.round(json.length / 1024), json })
    if (st.autoDownload) downloadJson(fileName, json)
  } catch (e) {
    console.warn('[record] failed to save recording', e)
  }
}
