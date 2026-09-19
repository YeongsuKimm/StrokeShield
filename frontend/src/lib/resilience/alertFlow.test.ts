import { describe, expect, it, vi } from 'vitest'
import type { AlertRequest, AlertResponse } from '../contracts'
import { ApiError } from './apiErrors'
import { performAlert, type AlertInputs } from './alertFlow'

const inputs: AlertInputs = { consented: true, reason: 'risk_threshold', symptoms: ['droop'], patientName: 'A' }
const ok: AlertResponse = { ok: true, dryRun: true, smsSid: 'x' }

describe('performAlert: an alert that fails says so, and never throws', () => {
  it('sent when the backend says ok', async () => {
    const send = vi.fn(async (_r: AlertRequest) => ok)
    const out = await performAlert(inputs, { locate: async () => undefined, send })
    expect(out.status).toBe('sent')
    expect(send.mock.calls[0][0]).toMatchObject({ reason: 'risk_threshold', symptoms: ['droop'] })
  })

  it('backend down (ApiError timeout / network): failed with the plain-words message', async () => {
    for (const kind of ['timeout', 'network', 'offline', 'server'] as const) {
      const out = await performAlert(inputs, {
        locate: async () => undefined,
        send: async () => {
          throw new ApiError(kind, `msg for ${kind}`)
        },
      })
      expect(out).toEqual({ status: 'failed', response: { ok: false, dryRun: false, error: `msg for ${kind}` } })
    }
  })

  it('an unexpected exception is still just "failed" with a generic sentence, never a raw error string', async () => {
    const out = await performAlert(inputs, {
      locate: async () => undefined,
      send: async () => {
        throw new TypeError('x is not a function')
      },
    })
    expect(out.status).toBe('failed')
    expect(out.response.error).toBe('Something went wrong sending the text.')
  })

  it('ok:false or a garbage reply is a failure with a reason', async () => {
    const a = await performAlert(inputs, { locate: async () => undefined, send: async () => ({ ok: false, dryRun: false, error: 'not configured' }) })
    expect(a).toMatchObject({ status: 'failed', response: { error: 'not configured' } })
    const b = await performAlert(inputs, { locate: async () => undefined, send: async () => undefined as unknown as AlertResponse })
    expect(b.status).toBe('failed')
    expect(b.response.error).toMatch(/did not confirm/)
  })

  it('a location failure never blocks the alert; without consent location is not even read', async () => {
    const send = vi.fn(async (_r: AlertRequest) => ok)
    await performAlert(inputs, { locate: () => Promise.reject(new Error('gps')), send })
    expect(send).toHaveBeenCalledOnce()
    const locate = vi.fn(async () => ({ lat: 1, lng: 2 }))
    await performAlert({ ...inputs, consented: false }, { locate, send })
    expect(locate).not.toHaveBeenCalled()
    expect(send.mock.calls[1][0].location).toBeUndefined()
  })
})
