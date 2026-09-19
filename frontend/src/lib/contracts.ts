// Mirror of docs/spec/01-architecture.md and backend/schemas.py.
// Change all three in the same PR and tell the team.

export type TestName = 'face' | 'arms' | 'speech'
export type Side = 'left' | 'right' | 'both' | 'none'

export interface TestResult {
  test: TestName
  severity: number // 0 = normal … 1 = clearly abnormal
  confidence: number // 0 = unusable … 1 = high quality capture
  metrics: Record<string, number>
  flags: string[]
  side?: Side // patient's left/right, when applicable
  startedAt: number // epoch ms
  durationMs: number
  needsRetry?: boolean
  transcript?: string // speech only
}

export interface VisionOpinion {
  kind: 'face' | 'arms'
  finding: 'asymmetric' | 'symmetric' | 'unclear'
  side: 'left' | 'right' | 'none'
  confidence: number
  rationale: string // <= 200 chars
}

export interface RiskContribution {
  test: TestName | 'vision'
  weight: number
  severity: number
  confidence: number
  contribution: number
}

export interface RiskBreakdown {
  risk: number // 0..1 overall
  threshold: number
  contributions: RiskContribution[]
  triggered: boolean
}

export interface AlertRequest {
  reason: 'risk_threshold' | 'user_request'
  risk?: RiskBreakdown
  patient: { name?: string; ageRange?: string }
  lastKnownWell?: string
  location?: { lat: number; lng: number; accuracyM?: number }
  symptoms: string[]
}
// No destination number here on purpose: the backend reads DEMO_PHONE_NUMBER.

export interface AlertResponse {
  ok: boolean
  dryRun: boolean
  callSid?: string
  smsSid?: string
  error?: string
}

export interface HealthResponse {
  ok: boolean
  dryRun: boolean
  demoMode: boolean
}
