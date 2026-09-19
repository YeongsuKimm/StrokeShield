import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FEATURES, resultBand, testSequence } from '../config'
import { useSession } from '../session/store'
import { CAUTION, HEALTHY, STROKE, runDemoScenario } from './scenarios'

const s = () => useSession.getState()

describe('demo mode (Shift+D DemoPanel) injection', () => {
  const eyes = FEATURES.eyesTest
  beforeEach(() => {
    s().clearAll() // a cold page: NO consent, no permissions
  })
  afterEach(() => {
    FEATURES.eyesTest = eyes
  })

  for (const withEyes of [true, false]) {
    describe(`eyes test ${withEyes ? 'on' : 'off'}`, () => {
      beforeEach(() => {
        FEATURES.eyesTest = withEyes
      })

      it('needs no consent and injects one result per configured test', () => {
        expect(s().consented).toBe(false)
        runDemoScenario(HEALTHY)
        expect(Object.keys(s().results).sort()).toEqual([...testSequence()].sort())
      })

      it('healthy -> low band on the clear screen', () => {
        runDemoScenario(HEALTHY)
        expect(s().phase).toBe('clear')
        expect(resultBand(s().risk!.risk)).toBe('low')
      })

      it('caution severities -> the middle band, still no alert', () => {
        runDemoScenario(CAUTION)
        expect(s().phase).toBe('clear')
        expect(resultBand(s().risk!.risk)).toBe('caution')
      })

      it('stroke -> high band: straight to the countdown, alert reason = risk threshold', () => {
        runDemoScenario(STROKE)
        expect(s().phase).toBe('countdown')
        expect(s().alertReason).toBe('risk_threshold')
        expect(resultBand(s().risk!.risk)).toBe('high')
        expect(Object.values(s().results).some((r) => r?.flags.length)).toBe(true)
      })
    })
  }

  it('the Countdown button path works from a cold page, and the countdown can be confirmed or cancelled', () => {
    s().requestEmergency('user_request')
    expect(s().phase).toBe('countdown')
    s().cancelCountdown()
    expect(s().phase).toBe('cancelled')
    s().requestEmergency('user_request')
    s().confirmCountdown()
    expect(s().phase).toBe('alerting')
    expect(s().alertStatus).toBe('sending')
  })

  it('re-running a scenario replaces the previous run (Reset session in between is not required)', () => {
    runDemoScenario(STROKE)
    runDemoScenario(HEALTHY)
    expect(s().phase).toBe('clear')
    expect(s().alertReason).toBeUndefined()
  })

  it('stops any live run first', () => {
    const stop = vi.fn()
    runDemoScenario(HEALTHY, stop)
    expect(stop).toHaveBeenCalledOnce()
  })
})
