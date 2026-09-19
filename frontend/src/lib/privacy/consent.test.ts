import { beforeEach, describe, expect, it } from 'vitest'
import { FAQS } from '../../components/pages/infoContent'
import { BROWSER_GRANT_NOTE, CONSENT_CHECKBOX_LABEL, CONSENT_POINTS, SECOND_OPINION_CONSENT_TEXT, VOICE_CONSENT_TEXT } from './consentText'
import { useSession } from '../session/store'

const s = () => useSession.getState()

describe('consent gating (session store)', () => {
  beforeEach(() => s().clearAll())

  it('starts unconsented, and a check cannot begin until the visitor consents', () => {
    expect(s().consented).toBe(false)
    expect(s().voiceConsent).toBe(false)
    s().beginTests()
    expect(s().phase).toBe('idle')
    s().giveConsent()
    s().beginTests()
    expect(s().phase).not.toBe('idle')
  })

  it('keeps consent across "run again" (reset) but drops it on clearAll', () => {
    s().giveConsent()
    s().setVoiceConsent(true)
    s().reset()
    expect(s().consented).toBe(true)
    expect(s().voiceConsent).toBe(true)
    s().clearAll()
    expect(s().consented).toBe(false)
    expect(s().voiceConsent).toBe(false)
  })

  it('the voice guide opt-in is independent of the main consent', () => {
    s().giveConsent()
    expect(s().voiceConsent).toBe(false)
  })
})

describe('privacy copy', () => {
  const all = [
    ...CONSENT_POINTS.map((p) => p.text),
    CONSENT_CHECKBOX_LABEL,
    VOICE_CONSENT_TEXT,
    SECOND_OPINION_CONSENT_TEXT,
    BROWSER_GRANT_NOTE,
    ...FAQS.map((f) => f.a),
  ].join(' ')

  it('names where data leaves the device', () => {
    const points = CONSENT_POINTS.map((p) => p.text).join(' ')
    expect(points).toMatch(/ElevenLabs/)
    expect(points).toMatch(/our server/)
    expect(points).toMatch(/not uploaded or stored/)
    expect(points).toMatch(/not a medical device/)
    expect(VOICE_CONSENT_TEXT).toMatch(/ElevenLabs/)
  })

  it('discloses that the free Gemini tier lets Google use content and reviewers read it', () => {
    expect(SECOND_OPINION_CONSENT_TEXT).toMatch(/Google/)
    expect(SECOND_OPINION_CONSENT_TEXT).toMatch(/improve its products/)
    expect(SECOND_OPINION_CONSENT_TEXT).toMatch(/human reviewers/)
  })

  it('never overclaims', () => {
    expect(all).not.toMatch(/HIPAA compliant|fully private|100% private|completely secure/i)
  })

  it('has a "What data does this use?" FAQ entry', () => {
    expect(FAQS.some((f) => f.q === 'What data does this use?')).toBe(true)
  })
})
