import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlertRequest, AlertResponse } from './contracts'

const sendAlert = vi.fn<(req: AlertRequest) => Promise<AlertResponse>>()
vi.mock('./api', () => ({ api: { sendAlert: (req: AlertRequest) => sendAlert(req) } }))

import { sendAlertForSession } from './alertFlow'
import { useSession } from './session/store'

const s = () => useSession.getState()

function startAlert() {
  s().requestEmergency('user_request')
  s().confirmCountdown()
}

beforeEach(() => {
  sendAlert.mockReset()
  s().reset()
})

describe('alert send flow', () => {
  it('a real send marks the session alerted, and the request has no destination field', async () => {
    sendAlert.mockResolvedValue({ ok: true, dryRun: false })
    startAlert()
    await sendAlertForSession()
    expect(s().phase).toBe('alerted')
    expect(s().alertStatus).toBe('sent')
    const body = sendAlert.mock.calls[0][0] as unknown as Record<string, unknown>
    expect(Object.keys(body).some((k) => /phone|number|dest|recipient|^to$/i.test(k))).toBe(false)
  })

  it('a DRY_RUN reply is stored as dryRun (the UI says nothing was sent)', async () => {
    sendAlert.mockResolvedValue({ ok: true, dryRun: true })
    startAlert()
    await sendAlertForSession()
    expect(s().alertResponse?.dryRun).toBe(true)
  })

  it.each([
    ['network error', () => Promise.reject(new TypeError('Failed to fetch')), /network/],
    ['HTTP 429', () => Promise.reject(Object.assign(new Error('x'), { status: 429, retryAfterS: 30 })), /too many requests/],
    ['HTTP 502', () => Promise.reject(Object.assign(new Error('x'), { status: 502 })), /server error/],
    ['ok:false', () => Promise.resolve({ ok: false, dryRun: false, error: 'Alert could not be sent' }), /could not be sent/],
  ])('%s leaves a failed status with a reason and stays on the alert screen', async (_n, impl, msg) => {
    sendAlert.mockImplementation(impl as () => Promise<AlertResponse>)
    startAlert()
    await sendAlertForSession()
    expect(s().phase).toBe('alerting')
    expect(s().alertStatus).toBe('failed')
    expect(s().alertResponse?.error).toMatch(msg)
  })

  it('does not send when the session is not in alerting+sending (a stray trigger)', async () => {
    await sendAlertForSession()
    expect(sendAlert).not.toHaveBeenCalled()
  })

  it('retryAlert is one-shot: a double click starts exactly one more send', async () => {
    sendAlert.mockResolvedValueOnce({ ok: false, dryRun: false, error: 'Alert could not be sent' })
    startAlert()
    await sendAlertForSession()
    expect(s().retryAlert()).toBe(true)
    expect(s().retryAlert()).toBe(false) // second click: already sending
    expect(s().alertStatus).toBe('sending')
    sendAlert.mockResolvedValueOnce({ ok: true, dryRun: false })
    await sendAlertForSession()
    await sendAlertForSession() // cannot send again once the status is 'sent'
    expect(sendAlert).toHaveBeenCalledTimes(2)
    expect(s().phase).toBe('alerted')
    expect(s().retryAlert()).toBe(false) // nothing to retry after success
  })

  it('a retry that hits the server 2-minute guard shows the wait, not success', async () => {
    sendAlert.mockResolvedValue({ ok: false, dryRun: false, error: 'rate limited: an alert was sent in the last 2 minutes' })
    startAlert()
    await sendAlertForSession()
    s().retryAlert()
    await sendAlertForSession()
    expect(s().alertStatus).toBe('failed')
    expect(s().alertResponse?.error).toMatch(/2 minutes/)
  })

  it('the in-flight alert is not restarted by "Send the alert"', () => {
    startAlert()
    s().requestEmergency('user_request')
    expect(s().phase).toBe('alerting')
    expect(s().alertStatus).toBe('sending')
  })
})
