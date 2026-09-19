// Sends the alert for the current session and records the outcome. The destination is decided by the backend
// (DEMO_PHONE_NUMBER); nothing here can choose a number. Called once per transition into alerting+sending.
import { alertRequestFromSession, buildShortMessage } from './alertPreview'
import { api } from './api'
import { failureFromError } from './alertFailure'
import { locationForAlert } from './media/permissions'
import { useSession } from './session/store'

export async function sendAlertForSession(): Promise<void> {
  const st = useSession.getState()
  if (st.phase !== 'alerting' || st.alertStatus !== 'sending') return
  try {
    // Location never blocks the alert: at most ALERT_LOCATION_CAP_MS for a refresh (only if already granted, never a
    // prompt), else the fix cached at the consent step, else none ("Location unavailable" in the text).
    // Without the consent tick nothing location-related is read at all.
    const location = await (st.consented ? locationForAlert(st.location) : Promise.resolve(undefined)).catch(() => undefined)
    const request = alertRequestFromSession(st, location)
    try {
      useSession.getState().setSentText(buildShortMessage(request)) // for the result screen; never blocks the send
    } catch {
      // the on-screen copy of the text is a courtesy
    }
    const res = await api.sendAlert(request)
    useSession.getState().setAlertResult(res.ok ? 'sent' : 'failed', res)
  } catch (e) {
    useSession.getState().setAlertResult('failed', failureFromError(e))
  }
}
