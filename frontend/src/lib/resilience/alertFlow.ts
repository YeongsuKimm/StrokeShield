// The alert send, extracted from App so its failure handling is unit-testable. Contract: NEVER throws and NEVER leaves
// the caller without an outcome, so the UI can always show "sent" or "did not go through" (docs/spec/05 safety guards).
import type { AlertRequest, AlertResponse } from '../contracts'
import { isApiError } from './apiErrors'

export interface AlertInputs {
  consented: boolean
  reason?: AlertRequest['reason']
  risk?: AlertRequest['risk']
  patientName?: string
  lastKnownWell?: string
  cachedLocation?: AlertRequest['location']
  symptoms: string[]
}

export interface AlertDeps {
  /** Location for the text: capped wait, never prompts. May reject; that just means "no location". */
  locate: (cached: AlertRequest['location']) => Promise<AlertRequest['location'] | undefined>
  send: (req: AlertRequest) => Promise<AlertResponse>
}

export interface AlertOutcome {
  status: 'sent' | 'failed'
  response: AlertResponse
}

export async function performAlert(inputs: AlertInputs, deps: AlertDeps): Promise<AlertOutcome> {
  try {
    // Without the consent tick nothing location-related is read at all.
    const location = inputs.consented ? await deps.locate(inputs.cachedLocation).catch(() => undefined) : undefined
    const res = await deps.send({
      reason: inputs.reason ?? 'user_request',
      risk: inputs.risk,
      patient: { name: inputs.patientName },
      lastKnownWell: inputs.lastKnownWell,
      location,
      symptoms: inputs.symptoms,
    })
    if (res && typeof res === 'object' && res.ok === true) return { status: 'sent', response: res }
    const error = res && typeof res.error === 'string' && res.error ? res.error : 'The server did not confirm the text.'
    return { status: 'failed', response: { ok: false, dryRun: !!res?.dryRun, error } }
  } catch (e) {
    const error = isApiError(e) ? e.message : 'Something went wrong sending the text.'
    return { status: 'failed', response: { ok: false, dryRun: false, error } }
  }
}
