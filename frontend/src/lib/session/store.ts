import { create } from 'zustand'
import { testSequence } from '../config'
import { computeRisk } from '../risk'
import type { AlertResponse, RiskBreakdown, TestName, TestResult, VisionOpinion } from '../contracts'

// State machine from docs/spec/06-frontend-ux.md. Agent tools and UI buttons call the SAME actions.
export type Phase =
  | 'idle'
  | 'consent'
  | 'intro'
  | 'face'
  | 'arms'
  | 'speech'
  | 'eyes' // only when FEATURES.eyesTest
  | 'scoring'
  | 'clear'
  | 'countdown'
  | 'alerting'
  | 'alerted'
  | 'cancelled'

export type AlertStatus = 'none' | 'sending' | 'sent' | 'failed'
export type AlertReason = 'risk_threshold' | 'user_request'

/** Which of the two top-level documents is on screen. The test flow always lives on 'home'. */
export type Route = 'home' | 'info'

export type PermissionKey = 'camera' | 'microphone' | 'location'
export type PermissionState = 'unknown' | 'prompt' | 'granted' | 'denied'

/** One line of the ElevenLabs agent transcript, rendered under the camera stage. */
export interface TranscriptLine {
  id: number
  speaker: 'agent' | 'patient'
  text: string
}

// First test in the configured order (config.ts testSequence) without a usable result, else 'scoring'.
// A skipped test counts as settled so the patient is never trapped on a step they cannot complete.
const pendingPhase = (results: Partial<Record<TestName, TestResult>>, skipped: TestName[]): Phase =>
  testSequence().find((t) => !skipped.includes(t) && (!results[t] || results[t]?.needsRetry)) ?? 'scoring'

interface SessionState {
  route: Route
  phase: Phase
  results: Partial<Record<TestName, TestResult>>
  /** Tests the patient chose to skip. Excluded from progression; they contribute nothing to the risk score. */
  skipped: TestName[]
  opinions: VisionOpinion[]
  risk: RiskBreakdown | null
  lastKnownWell?: string
  location?: { lat: number; lng: number; accuracyM?: number }
  patientName?: string
  permissions: Record<PermissionKey, PermissionState>
  agentConnected: boolean
  transcript: TranscriptLine[]
  /** True while the patient's microphone is muted or silent — the speech test cannot work in that state. */
  micMuted: boolean
  alertReason?: AlertReason
  alertStatus: AlertStatus
  alertResponse?: AlertResponse
  demoEnabled: boolean
  /** Live positioning caption, e.g. "Step back until I can see both hands." */
  hint?: string

  setRoute: (route: Route) => void
  goHome: () => void
  start: () => void
  acceptConsent: () => void
  beginTests: () => void
  setLastKnownWell: (text: string) => void
  setLocation: (loc: SessionState['location']) => void
  setPermission: (key: PermissionKey, state: PermissionState) => void
  setAgentConnected: (v: boolean) => void
  addTranscript: (speaker: TranscriptLine['speaker'], text: string) => void
  setMicMuted: (v: boolean) => void
  addOpinions: (o: VisionOpinion[]) => void
  /** Store a test result and advance. Retry results stay on the same phase. */
  completeTest: (result: TestResult) => void
  /** Leave a test unmeasured and move on (the 15 s escape hatch). */
  skipTest: (test: TestName) => void
  /** User asked for help (button or agent tool). Bypasses the score. */
  requestEmergency: (reason?: AlertReason) => void
  cancelCountdown: () => void
  confirmCountdown: () => void
  setAlertResult: (status: AlertStatus, res?: AlertResponse) => void
  setDemoEnabled: (v: boolean) => void
  setHint: (hint?: string) => void
  reset: () => void
}

const initial = {
  route: 'home' as Route,
  phase: 'idle' as Phase,
  results: {},
  skipped: [] as TestName[],
  opinions: [],
  risk: null,
  permissions: { camera: 'unknown', microphone: 'unknown', location: 'unknown' } as Record<PermissionKey, PermissionState>,
  agentConnected: false,
  transcript: [] as TranscriptLine[],
  micMuted: false,
  alertStatus: 'none' as AlertStatus,
  hint: undefined,
  alertReason: undefined,
  alertResponse: undefined,
  lastKnownWell: undefined,
}

/** Phases where the patient is mid-check: the page must not scroll away and the flow must not be interrupted. */
export const isTestPhase = (p: Phase): boolean => ['face', 'arms', 'speech', 'eyes'].includes(p)

/** Phases that show an outcome rather than a test. */
export const isResultPhase = (p: Phase): boolean =>
  ['scoring', 'clear', 'countdown', 'alerting', 'alerted', 'cancelled'].includes(p)

let transcriptId = 0

export const useSession = create<SessionState>((set, get) => ({
  ...initial,
  demoEnabled: new URLSearchParams(globalThis.location?.search ?? '').get('demo') === '1',

  setRoute: (route) => set({ route }),
  goHome: () => set({ route: 'home', phase: 'idle' }),
  start: () => set({ phase: 'consent', route: 'home' }),
  acceptConsent: () => set({ phase: 'intro' }),
  beginTests: () => set({ phase: testSequence()[0], route: 'home' }),
  setLastKnownWell: (lastKnownWell) => set({ lastKnownWell }),
  setLocation: (location) => set({ location }),
  setPermission: (key, state) => set((s) => ({ permissions: { ...s.permissions, [key]: state } })),
  setAgentConnected: (agentConnected) => set({ agentConnected }),
  addTranscript: (speaker, text) =>
    set((s) => ({ transcript: [...s.transcript, { id: ++transcriptId, speaker, text }].slice(-30) })),
  setMicMuted: (micMuted) => set({ micMuted }),
  addOpinions: (o) => set((s) => ({ opinions: [...s.opinions, ...o] })),

  completeTest: (result) => {
    const results = { ...get().results, [result.test]: result }
    const risk = computeRisk(results, get().opinions)
    if (result.needsRetry) {
      set({ results, risk })
      return
    }
    const next = pendingPhase(results, get().skipped)
    if (next !== 'scoring') {
      set({ results, risk, phase: next })
    } else if (risk.triggered) {
      set({ results, risk, phase: 'countdown', alertReason: 'risk_threshold' })
    } else {
      set({ results, risk, phase: 'clear' })
    }
  },

  skipTest: (test) => {
    const skipped = get().skipped.includes(test) ? get().skipped : [...get().skipped, test]
    const results = get().results
    const risk = computeRisk(results, get().opinions)
    const next = pendingPhase(results, skipped)
    if (next !== 'scoring') {
      set({ skipped, risk, phase: next })
    } else if (risk.triggered) {
      set({ skipped, risk, phase: 'countdown', alertReason: 'risk_threshold' })
    } else {
      set({ skipped, risk, phase: 'clear' })
    }
  },

  requestEmergency: (reason = 'user_request') => set({ phase: 'countdown', alertReason: reason, route: 'home' }),
  cancelCountdown: () => set({ phase: 'cancelled', alertReason: undefined }),
  confirmCountdown: () => set({ phase: 'alerting', alertStatus: 'sending' }),
  setAlertResult: (alertStatus, alertResponse) =>
    set({ alertStatus, alertResponse, phase: alertStatus === 'sent' ? 'alerted' : get().phase }),
  setDemoEnabled: (demoEnabled) => set({ demoEnabled }),
  setHint: (hint) => set({ hint }),
  reset: () => set({ ...initial, permissions: { ...initial.permissions } }),
}))
