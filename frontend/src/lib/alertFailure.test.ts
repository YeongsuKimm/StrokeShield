import { describe, expect, it } from 'vitest'
import { describeAlertFailure, failureFromError, formatWait, isDemoNothingSent, SERVER_ALERT_COOLDOWN_S } from './alertFailure'

const fail = (error?: string) => ({ ok: false, dryRun: false, error })

describe('failureFromError', () => {
  it('maps a fetch failure to a network category', () => {
    const res = failureFromError(new TypeError('Failed to fetch'))
    expect(describeAlertFailure(res).category).toBe('network')
  })
  it('maps a timeout (AbortError) to network with the timeout wording', () => {
    const e = Object.assign(new Error('aborted'), { name: 'AbortError' })
    expect(failureFromError(e).error).toMatch(/did not answer in time/)
    expect(describeAlertFailure(failureFromError(e)).category).toBe('network')
  })
  it('uses the Retry-After of an HTTP 429', () => {
    const d = describeAlertFailure(failureFromError({ status: 429, retryAfterS: 42, message: 'x' }))
    expect(d.category).toBe('rate_limited')
    expect(d.retryAfterS).toBe(42)
  })
  it('falls back to the seconds in the 429 body', () => {
    const d = describeAlertFailure(failureFromError({ status: 429, message: 'too many requests, try again in 17 s' }))
    expect(d.retryAfterS).toBe(17)
  })
  it('maps 5xx to server and other 4xx to a rejected request', () => {
    expect(describeAlertFailure(failureFromError({ status: 503 })).category).toBe('server')
    expect(describeAlertFailure(failureFromError({ status: 500, message: 'internal error' })).category).toBe('server')
    expect(describeAlertFailure(failureFromError({ status: 422 })).title).toMatch(/rejected/)
  })
  it('never throws on junk', () => {
    expect(describeAlertFailure(failureFromError(null)).category).toBe('network')
    expect(describeAlertFailure(failureFromError('boom')).category).toBe('network')
  })
})

describe('describeAlertFailure (server ok:false messages)', () => {
  it('the 2-minute guard says an alert already went out and waits 120 s', () => {
    const d = describeAlertFailure(fail('rate limited: an alert was sent in the last 2 minutes'))
    expect(d.category).toBe('rate_limited')
    expect(d.retryAfterS).toBe(SERVER_ALERT_COOLDOWN_S)
    expect(d.title).toMatch(/already sent/)
  })
  it.each([
    ['DEMO_PHONE_NUMBER is not set or not valid E.164', 'not_configured'],
    ['email-to-SMS needs a US DEMO_PHONE_NUMBER and a valid SMS_GATEWAY_DOMAIN', 'not_configured'],
    ['email-to-SMS is not configured (SMTP_USER / SMTP_APP_PASSWORD)', 'not_configured'],
    ['Twilio credentials are not configured', 'not_configured'],
    ['risk below threshold; alert refused', 'refused'],
    ['Alert could not be sent', 'delivery'],
    ['SMS could not be sent (Twilio error 30034)', 'delivery'],
  ])('%s -> %s', (error, category) => {
    expect(describeAlertFailure(fail(error)).category).toBe(category)
  })
  it('a missing error text still gives a plain delivery failure', () => {
    expect(describeAlertFailure(fail()).category).toBe('delivery')
    expect(describeAlertFailure(undefined).retryAfterS).toBe(0)
  })
  it('a delivery failure never claims the text went out', () => {
    const d = describeAlertFailure(fail('Alert could not be sent'))
    expect(d.detail).toMatch(/No text was confirmed sent/)
  })
  it.each(['TypeError: Failed to fetch', 'Error: boom', 'x'.repeat(120)])('never prints raw error text: %s', (raw) => {
    const d = describeAlertFailure(fail(raw))
    expect(d.detail).toBe('No text was confirmed sent.')
  })
})

describe('helpers', () => {
  it('dry run is reported as nothing sent, and only for ok+dryRun', () => {
    expect(isDemoNothingSent({ ok: true, dryRun: true })).toBe(true)
    expect(isDemoNothingSent({ ok: true, dryRun: false })).toBe(false)
    expect(isDemoNothingSent({ ok: false, dryRun: true })).toBe(false)
    expect(isDemoNothingSent(undefined)).toBe(false)
  })
  it('formats the wait', () => {
    expect(formatWait(120)).toBe('2:00')
    expect(formatWait(61.2)).toBe('1:02')
    expect(formatWait(-3)).toBe('0:00')
  })
})
