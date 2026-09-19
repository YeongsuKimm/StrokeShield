import { describe, expect, it } from 'vitest'
import { describeAlertFailure, failureFromError } from './alertFailure'
import { ApiError } from './resilience/apiErrors'

// The typed errors from lib/api.ts feed the shared alert-failure categories (alertFailure.ts).
describe('failureFromError understands the typed ApiError', () => {
  it('timeout, offline and network are "network" failures with distinct wording', () => {
    for (const kind of ['timeout', 'offline', 'network'] as const) {
      const r = failureFromError(new ApiError(kind, 'x'))
      expect(describeAlertFailure(r).category).toBe('network')
    }
    expect(failureFromError(new ApiError('timeout', 'x')).error).toMatch(/in time/)
    expect(failureFromError(new ApiError('offline', 'x')).error).toMatch(/offline/)
  })

  it('429 keeps the Retry-After wait; 5xx is a server error; other 4xx is rejected', () => {
    const limited = describeAlertFailure(failureFromError(new ApiError('rate-limited', 'x', 429, 45)))
    expect(limited).toMatchObject({ category: 'rate_limited', retryAfterS: 45 })
    expect(describeAlertFailure(failureFromError(new ApiError('server', 'x', 503))).category).toBe('server')
    expect(describeAlertFailure(failureFromError(new ApiError('client', 'x', 400))).category).toBe('server')
  })
})
