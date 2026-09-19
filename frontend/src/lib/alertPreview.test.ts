import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AlertRequest, RiskBreakdown, TestResult } from './contracts'
import { MAX_SMS_CHARS, alertRequestFromSession, buildShortMessage, deliveryMode, previewMessage, pyFixed } from './alertPreview'

// The SAME file backend tests/test_alert_message_vectors.py reads: the Python builder produced expectedText.
const vectors = JSON.parse(readFileSync(new URL('../../../tests/fixtures/alert_message_vectors.json', import.meta.url), 'utf8')) as {
  name: string
  request: AlertRequest
  expectedText: string
}[]

describe('alert preview mirrors services/email_sms_service.py::build_short_message', () => {
  it('reads a meaningful set of golden vectors', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(20)
  })

  for (const v of vectors) {
    it(`vector: ${v.name}`, () => {
      const text = buildShortMessage(v.request)
      expect(text).toBe(v.expectedText)
      expect(Array.from(text).length).toBeLessThanOrEqual(MAX_SMS_CHARS)
      expect(text).not.toMatch(/[\r\n]/)
    })
  }

  it('never includes the patient name', () => {
    const req: AlertRequest = { reason: 'user_request', patient: { name: 'Jane Roe' }, symptoms: [], lastKnownWell: 'noon' }
    expect(buildShortMessage(req)).not.toContain('Jane')
  })
})

describe('pyFixed (Python format() rounding)', () => {
  it('rounds exact ties to even, unlike toFixed', () => {
    expect(pyFixed(12.5, 0)).toBe('12')
    expect(pyFixed(13.5, 0)).toBe('14')
    expect(pyFixed(0.5, 0)).toBe('0')
    expect(pyFixed(0.03125, 4)).toBe('0.0312')
    expect(pyFixed(0.09375, 4)).toBe('0.0938')
    expect(pyFixed(-0.03125, 4)).toBe('-0.0312')
  })
  it('matches toFixed away from ties', () => {
    expect(pyFixed(39.32981234, 4)).toBe('39.3298')
    expect(pyFixed(-76.61947, 4)).toBe('-76.6195')
    expect(pyFixed(67, 0)).toBe('67')
  })
})

const risk = (r: number): RiskBreakdown => ({ risk: r, threshold: 0.5, contributions: [], triggered: r >= 0.5 })
const result = (test: TestResult['test'], flags: string[]): TestResult => ({ test, severity: 0.7, confidence: 0.9, metrics: {}, flags, startedAt: 0, durationMs: 1 })

describe('previewMessage and alertRequestFromSession', () => {
  const base = {
    alertReason: 'risk_threshold' as const,
    risk: risk(0.62),
    patientName: 'Jane Roe',
    lastKnownWell: '8:30 pm',
    results: { arms: result('arms', ['left arm drifted down']), face: result('face', []) },
    consented: true,
    location: { lat: 39.3298123, lng: -76.6194701 },
  }

  it('builds the same request the alert flow posts (flags from every result, in order)', () => {
    const req = alertRequestFromSession(base, base.location)
    expect(req.symptoms).toEqual(['left arm drifted down'])
    expect(req.reason).toBe('risk_threshold')
    expect(req.patient).toEqual({ name: 'Jane Roe' })
  })

  it('shows the cached location only when the visitor consented, and never the name', () => {
    expect(previewMessage(base)).toBe(
      'StrokeShield ALERT: possible stroke signs. Last well: 8:30 pm. Map: maps.google.com/?q=39.3298,-76.6195 Flags: left arm drifted down. Risk 62%. Demo message.',
    )
    const noConsent = previewMessage({ ...base, consented: false }) ?? ''
    expect(noConsent).toContain('Location unavailable.')
    expect(noConsent).not.toContain('maps.google')
    expect(noConsent).not.toContain('Jane')
  })

  it('is plain ASCII for ordinary input', () => {
    const text = previewMessage(base) ?? ''
    expect(/^[\x20-\x7e]+$/.test(text)).toBe(true)
  })

  it('returns null instead of throwing when the session is malformed', () => {
    const broken = { ...base, results: null } as unknown as typeof base
    expect(previewMessage(broken)).toBeNull()
  })

  it('falls back to a user request without a risk', () => {
    const text = previewMessage({ ...base, alertReason: undefined, risk: null, results: {} }) ?? ''
    expect(text).not.toContain('Risk')
  })
})

describe('deliveryMode', () => {
  it('reads dryRun from health or the alert response, and says unknown for anything else', () => {
    expect(deliveryMode({ dryRun: true })).toBe('demo')
    expect(deliveryMode({ dryRun: false })).toBe('live')
    expect(deliveryMode(null)).toBe('unknown')
    expect(deliveryMode(undefined)).toBe('unknown')
    expect(deliveryMode({})).toBe('unknown')
    expect(deliveryMode({ dryRun: 'yes' })).toBe('unknown')
  })
})
