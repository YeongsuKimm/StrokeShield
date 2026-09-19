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
  /** The visitor ticked the consent box (docs/spec/06 "Privacy"). Until then nothing opens the camera or microphone,
   *  asks the browser for a permission, or starts a check. Not persisted anywhere: every page load starts unconsented. */
  consented: boolean
  /** Separate opt-in for the ElevenLabs voice guide, which streams microphone audio to a third party. */
  voiceConsent: boolean
  agentConnected: boolean
  transcript: TranscriptLine[]
  /** True while the patient's microphone is muted or silent — the speech test cannot work in that state. */
  micMuted: boolean
  alertReason?: AlertReason
  alertStatus: AlertStatus
  alertResponse?: AlertResponse
  /** ms epoch of the last alert outcome (drives the retry wait shown after a rate limit). */
  alertResultAt?: number
  /** The exact alert text built for the last send (memory only; shown on the result screen, wiped with the session). */
  sentText?: string
  demoEnabled: boolean
  /** Live positioning caption, e.g. "Step back until I can see both hands." */
  hint?: string

  setRoute: (route: Route) => void
  goHome: () => void
  start: () => void
  acceptConsent: () => void
  giveConsent: () => void
  setVoiceConsent: (v: boolean) => void
  beginTests: () => void
  setLastKnownWell: (text: string) => void
  setPhase: (phase: Phase) => void
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
  /** After a FAILED alert: send once more (no countdown). Returns false, and does nothing, unless the last attempt failed. */
  retryAlert: () => boolean
  setAlertResult: (status: AlertStatus, res?: AlertResponse) => void
  setSentText: (text?: string) => void
  setDemoEnabled: (v: boolean) => void
  setHint: (hint?: string) => void
  reset: () => void
  /** Withdraw consent and forget everything held in memory (see lib/privacy/clearData.ts for the full wipe). */
  clearAll: () => void
}

const initial = {
  route: 'home' as Route,
  phase: 'idle' as Phase,
  results: {},
  skipped: [] as TestName[],
  opinions: [],
  risk: null,
  permissions: { camera: 'unknown', microphone: 'unknown', location: 'unknown' } as Record<PermissionKey, PermissionState>,
  consented: false,
  voiceConsent: false,
  agentConnected: false,
  transcript: [] as TranscriptLine[],
  micMuted: false,
  alertStatus: 'none' as AlertStatus,
  hint: undefined,
  alertReason: undefined,
  alertResponse: undefined,
  alertResultAt: undefined,
  sentText: undefined,
  lastKnownWell: undefined,
}

/** Phases where the patient is mid-check: the page must not scroll away and the flow must not be interrupted. */
export const isTestPhase = (p: Phase): boolean => ['face', 'arms', 'speech', 'eyes'].includes(p)

/** Phases that show an outcome rather than a test. */
export const isResultPhase = (p: Phase): boolean =>
  ['scoring', 'clear', 'countdown', 'alerting', 'alerted', 'cancelled'].includes(p)

/** The per-run part of the state: what "start over" and a fresh `beginTests` both clear. */
const freshRun = () => ({
  phase: 'idle' as Phase,
  results: {} as Partial<Record<TestName, TestResult>>,
  skipped: [] as TestName[],
  opinions: [] as VisionOpinion[],
  risk: null as RiskBreakdown | null,
  alertStatus: 'none' as AlertStatus,
  alertReason: undefined as AlertReason | undefined,
  alertResponse: undefined as AlertResponse | undefined,
  alertResultAt: undefined as number | undefined,
  sentText: undefined as string | undefined,
  hint: undefined as string | undefined,
})

/** Phases where a finished (or skipped) check may move the flow on. Anywhere else (countdown, alert, result screens) a
 *  late result from a run that was still finishing is recorded but must NOT steal the screen from the emergency path. */
const advancesOnResult = (p: Phase): boolean => p === 'idle' || p === 'consent' || p === 'intro' || p === 'scoring' || isTestPhase(p)

const inEmergency = (p: Phase): boolean => p === 'countdown' || p === 'alerting'

const KNOWN_TESTS: readonly TestName[] = ['face', 'arms', 'speech', 'eyes']
const isKnownTest = (t: unknown): t is TestName => KNOWN_TESTS.includes(t as TestName)

/** A result the scorer can trust: a known test and finite numbers. Anything else becomes an unscored retry (never a
 *  NaN in the risk score, never a result filed under a test that does not exist). Returns null for an unknown test. */
function sanitizeResult(r: TestResult): TestResult | null {
  if (!r || !isKnownTest(r.test)) return null
  if (Number.isFinite(r.severity) && Number.isFinite(r.confidence)) return r
  return { ...r, severity: 0, confidence: 0, needsRetry: true, flags: r.flags?.length ? r.flags : ['Could not read that result. Please try again.'] }
}

let transcriptId = 0

export const useSession = create<SessionState>((set, get) => ({
  ...initial,
  demoEnabled: new URLSearchParams(globalThis.location?.search ?? '').get('demo') === '1',

  setRoute: (route) => set({ route }),
  // "Home" is a fresh start: leftover results, skips or alert state must not follow the visitor into the next run.
  goHome: () => get().reset(),
  // Like beginTests, these never pull the screen away from a countdown or an alert in flight.
  start: () => {
    if (!inEmergency(get().phase)) set({ ...freshRun(), phase: 'consent', route: 'home' })
  },
  acceptConsent: () => {
    if (get().phase === 'consent') set({ phase: 'intro' }) // only the step after 'consent'; never out of a result screen
  },
  giveConsent: () => set({ consented: true }),
  setVoiceConsent: (voiceConsent) => set({ voiceConsent }),
  // No consent, no check: the camera and microphone are only ever opened by a screen that this transition reveals.
  beginTests: () => {
    if (!get().consented) return
    // Never yank the screen away from the countdown or an alert in flight; those end through Cancel / their result.
    if (inEmergency(get().phase)) return
    // A new run starts clean, whatever screen it was started from (stale skips and results would land the patient on
    // a step that is already skipped, or score old readings).
    set({ ...freshRun(), phase: testSequence()[0], route: 'home' })
  },
  setLastKnownWell: (lastKnownWell) => set({ lastKnownWell }),
  setPhase: (phase) => set({ phase, route: 'home' }),
  setLocation: (location) => set({ location }),
  setPermission: (key, state) => set((s) => ({ permissions: { ...s.permissions, [key]: state } })),
  setAgentConnected: (agentConnected) => set({ agentConnected }),
  addTranscript: (speaker, text) =>
    set((s) => ({ transcript: [...s.transcript, { id: ++transcriptId, speaker, text }].slice(-30) })),
  setMicMuted: (micMuted) => set({ micMuted }),
  addOpinions: (o) => set((s) => ({ opinions: [...s.opinions, ...o] })),

  completeTest: (incoming) => {
    const result = sanitizeResult(incoming)
    if (!result) return
    const results = { ...get().results, [result.test]: result }
    const risk = computeRisk(results, get().opinions)
    if (result.needsRetry || !advancesOnResult(get().phase)) {
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
    if (!isKnownTest(test) || !advancesOnResult(get().phase)) return
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

  // The alert actions are guarded by phase: agent tools, timers and in-flight requests can all arrive late (after
  // Cancel, after "start over"), and a late call must never drag the patient into a screen they already left.
  // An alert still in flight is never restarted, so it cannot text the contact twice; after a FAILED one the patient
  // can ask again.
  requestEmergency: (reason = 'user_request') => {
    if (get().phase === 'alerting' && get().alertStatus === 'sending') return
    // A fresh request wipes the previous attempt's outcome (a stale "sent" or "failed" must not sit behind the countdown).
    set({ phase: 'countdown', alertReason: reason, route: 'home', alertStatus: 'none', alertResponse: undefined, alertResultAt: undefined })
  },
  cancelCountdown: () => {
    if (get().phase !== 'countdown') return
    set({ phase: 'cancelled', alertReason: undefined })
  },
  confirmCountdown: () => {
    if (get().phase !== 'countdown') return
    set({ phase: 'alerting', alertStatus: 'sending', alertResponse: undefined }) // drop a previous attempt's error
  },
  // One-shot: only a failed alert can be retried, and it flips to 'sending' synchronously, so a double click (or an
  // agent tool and a click together) cannot start two sends.
  retryAlert: () => {
    if (get().phase !== 'alerting' || get().alertStatus !== 'failed') return false
    set({ alertStatus: 'sending', alertResponse: undefined })
    return true
  },
  setAlertResult: (alertStatus, alertResponse) => {
    // A response that lands after the session was reset must not paint "Alert sent" onto the next session.
    if (get().phase !== 'alerting' || (alertStatus !== 'sent' && alertStatus !== 'failed')) return
    set({ alertStatus, alertResponse, alertResultAt: Date.now(), phase: alertStatus === 'sent' ? 'alerted' : 'alerting' })
  },
  setSentText: (sentText) => set({ sentText }),
  setDemoEnabled: (demoEnabled) => set({ demoEnabled }),
  setHint: (hint) => set({ hint }),
  // Permissions and the voice connection are facts about the browser / a live socket, not about this session: keep
  // them. Clearing them made the consent card claim "Not asked yet" for a camera the patient already allowed (it
  // only re-queries the browser when it mounts) and the transcript strip say "not connected" mid-conversation
  // (the agent only reports connect/disconnect events, never again).
  // Consent is also a fact about the visitor rather than the run, so "Run the check again" does not ask again; the
  // logo and "Clear my data" use `clearAll`, which forgets it.
  reset: () =>
    set({
      ...initial,
      permissions: { ...get().permissions },
      agentConnected: get().agentConnected,
      consented: get().consented,
      voiceConsent: get().voiceConsent,
    }),
  clearAll: () =>
    set({
      ...initial,
      transcript: [],
      skipped: [],
      opinions: [],
      results: {},
      permissions: { camera: 'unknown', microphone: 'unknown', location: 'unknown' },
      location: undefined,
      patientName: undefined,
      lastKnownWell: undefined,
    }),
}))
