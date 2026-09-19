import { create } from 'zustand'
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
  | 'scoring'
  | 'clear'
  | 'countdown'
  | 'alerting'
  | 'alerted'
  | 'cancelled'

export type AlertStatus = 'none' | 'sending' | 'sent' | 'failed'
export type AlertReason = 'risk_threshold' | 'user_request'

const NEXT_TEST: Record<TestName, Phase> = { face: 'arms', arms: 'speech', speech: 'scoring' }

interface SessionState {
  phase: Phase
  results: Partial<Record<TestName, TestResult>>
  opinions: VisionOpinion[]
  risk: RiskBreakdown | null
  lastKnownWell?: string
  location?: { lat: number; lng: number; accuracyM?: number }
  patientName?: string
  agentConnected: boolean
  alertReason?: AlertReason
  alertStatus: AlertStatus
  alertResponse?: AlertResponse
  demoEnabled: boolean

  start: () => void
  acceptConsent: () => void
  beginTests: () => void
  setLastKnownWell: (text: string) => void
  setLocation: (loc: SessionState['location']) => void
  setAgentConnected: (v: boolean) => void
  addOpinions: (o: VisionOpinion[]) => void
  /** Store a test result and advance. Retry results stay on the same phase. */
  completeTest: (result: TestResult) => void
  /** User asked for help (button or agent tool). Bypasses the score. */
  requestEmergency: (reason?: AlertReason) => void
  cancelCountdown: () => void
  confirmCountdown: () => void
  setAlertResult: (status: AlertStatus, res?: AlertResponse) => void
  setDemoEnabled: (v: boolean) => void
  reset: () => void
}

const initial = {
  phase: 'idle' as Phase,
  results: {},
  opinions: [],
  risk: null,
  agentConnected: false,
  alertStatus: 'none' as AlertStatus,
}

export const useSession = create<SessionState>((set, get) => ({
  ...initial,
  demoEnabled: new URLSearchParams(globalThis.location?.search ?? '').get('demo') === '1',

  start: () => set({ phase: 'consent' }),
  acceptConsent: () => set({ phase: 'intro' }),
  beginTests: () => set({ phase: 'face' }),
  setLastKnownWell: (lastKnownWell) => set({ lastKnownWell }),
  setLocation: (location) => set({ location }),
  setAgentConnected: (agentConnected) => set({ agentConnected }),
  addOpinions: (o) => set((s) => ({ opinions: [...s.opinions, ...o] })),

  completeTest: (result) => {
    const results = { ...get().results, [result.test]: result }
    const risk = computeRisk(results, get().opinions)
    if (result.needsRetry) {
      set({ results, risk })
      return
    }
    const next = NEXT_TEST[result.test]
    if (next !== 'scoring') {
      set({ results, risk, phase: next })
    } else if (risk.triggered) {
      set({ results, risk, phase: 'countdown', alertReason: 'risk_threshold' })
    } else {
      set({ results, risk, phase: 'clear' })
    }
  },

  requestEmergency: (reason = 'user_request') => set({ phase: 'countdown', alertReason: reason }),
  cancelCountdown: () => set({ phase: 'cancelled', alertReason: undefined }),
  confirmCountdown: () => set({ phase: 'alerting', alertStatus: 'sending' }),
  setAlertResult: (alertStatus, alertResponse) =>
    set({ alertStatus, alertResponse, phase: alertStatus === 'sent' ? 'alerted' : get().phase }),
  setDemoEnabled: (demoEnabled) => set({ demoEnabled }),
  reset: () => set({ ...initial }),
}))
