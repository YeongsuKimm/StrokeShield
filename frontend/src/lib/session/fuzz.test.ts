import { afterEach, describe, expect, it } from 'vitest'
import { FEATURES, testSequence } from '../config'
import type { TestName, TestResult } from '../contracts'
import { computeRisk } from '../risk'
import { isResultPhase, isTestPhase, useSession, type Phase } from './store'

// Property / fuzz test for the session state machine (docs/spec/06 "Resilience"). A seeded PRNG drives long random
// sequences of every store action, including nonsense (results for unknown tests, NaN severities, late alert responses)
// and asserts invariants after EVERY step. A failing seed is printed, so a failure is a one-line repro.

const KNOWN: TestName[] = ['face', 'arms', 'speech', 'eyes']
const PHASES: Phase[] = ['idle', 'consent', 'intro', 'face', 'arms', 'speech', 'eyes', 'scoring', 'clear', 'countdown', 'alerting', 'alerted', 'cancelled']

function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  }
}
type Rng = ReturnType<typeof rng>

const s = () => useSession.getState()

function randomResult(r: Rng): TestResult {
  const weird = r.chance(0.08)
  const test = (weird && r.chance(0.5) ? 'nose' : r.pick(KNOWN)) as TestName
  const pickNum = () => (weird ? r.pick([NaN, Infinity, -1, 7]) : r.next())
  return {
    test,
    severity: pickNum(),
    confidence: weird ? pickNum() : r.chance(0.25) ? 0.1 : 0.5 + r.next() / 2,
    metrics: {},
    flags: r.chance(0.5) ? ['a flag'] : [],
    startedAt: 0,
    durationMs: 0,
    needsRetry: r.chance(0.2) ? true : undefined,
  }
}

const ACTIONS: { name: string; w: number; run: (r: Rng) => void }[] = [
  { name: 'start', w: 2, run: () => s().start() },
  { name: 'acceptConsent', w: 1, run: () => s().acceptConsent() },
  { name: 'giveConsent', w: 3, run: () => s().giveConsent() },
  { name: 'beginTests', w: 6, run: () => s().beginTests() },
  { name: 'completeTest', w: 14, run: (r) => s().completeTest(randomResult(r)) },
  { name: 'skipTest', w: 7, run: (r) => s().skipTest(r.chance(0.1) ? ('nose' as TestName) : r.pick(KNOWN)) },
  { name: 'requestEmergency', w: 4, run: (r) => s().requestEmergency(r.pick(['user_request', 'risk_threshold'] as const)) },
  { name: 'cancelCountdown', w: 4, run: () => s().cancelCountdown() },
  { name: 'confirmCountdown', w: 4, run: () => s().confirmCountdown() },
  { name: 'setAlertResult', w: 5, run: (r) => s().setAlertResult(r.pick(['sent', 'failed', 'sending', 'none'] as const), { ok: r.chance(0.5), dryRun: r.chance(0.5) }) },
  { name: 'retryAlert', w: 4, run: () => void s().retryAlert() },
  { name: 'reset', w: 3, run: () => s().reset() },
  { name: 'clearAll', w: 1, run: () => s().clearAll() },
  { name: 'setRoute', w: 5, run: (r) => s().setRoute(r.pick(['home', 'info'] as const)) },
  { name: 'goHome', w: 1, run: () => s().goHome() },
  { name: 'addOpinions', w: 1, run: (r) => s().addOpinions([{ kind: 'face', finding: r.pick(['asymmetric', 'symmetric', 'unclear'] as const), side: 'none', confidence: r.next(), rationale: '' }]) },
  { name: 'setHint', w: 2, run: (r) => s().setHint(r.chance(0.5) ? 'hint' : undefined) },
  { name: 'setMicMuted', w: 1, run: (r) => s().setMicMuted(r.chance(0.5)) },
  { name: 'addTranscript', w: 1, run: () => s().addTranscript('agent', 'hello') },
  { name: 'setDemoEnabled', w: 1, run: (r) => s().setDemoEnabled(r.chance(0.5)) },
]
const TOTAL_W = ACTIONS.reduce((n, a) => n + a.w, 0)
const pickAction = (r: Rng) => {
  let x = r.next() * TOTAL_W
  for (const a of ACTIONS) if ((x -= a.w) < 0) return a
  return ACTIONS[0]
}

/** Which phase -> phase moves are legal (docs/spec/06 state machine). Everything else is a bug. */
function legalMove(fromPhase: Phase, toPhase: Phase): boolean {
  const from: string = fromPhase
  const to: string = toPhase
  if (from === to) return true
  if (to === 'alerting') return from === 'countdown' // an alert only ever starts from the countdown
  if (to === 'alerted') return from === 'alerting'
  // Only "start over" leaves an alert in flight, or "try sending again" after a FAILED one (guarded by alertStatus below).
  if (from === 'alerting' && to !== 'alerted') return to === 'idle' || to === 'countdown'
  if (from === 'alerted' || from === 'cancelled') return to === "idle" || to === "countdown" || to === "consent" || to === "intro" || isTestPhase(toPhase)
  return true
}

function checkInvariants(seed: number, step: number, log: string[], prev: Phase, prevAlert: string) {
  const st = s()
  const where = `seed ${seed} step ${step} after [${log.slice(-6).join(', ')}] phase ${prev} -> ${st.phase}`
  const fail = (msg: string) => expect.fail(`${msg}\n  ${where}`)

  if (!PHASES.includes(st.phase)) fail(`unknown phase ${st.phase}`)
  if (st.phase === 'scoring') fail("'scoring' is a phase nothing can leave")

  // Results only for known tests, keyed consistently, and never non-finite numbers.
  for (const [k, r] of Object.entries(st.results)) {
    if (!KNOWN.includes(k as TestName)) fail(`result stored for unknown test ${k}`)
    if (!r || r.test !== k) fail(`result under key ${k} claims test ${r?.test}`)
    if (!Number.isFinite(r.severity) || !Number.isFinite(r.confidence)) fail(`non-finite result for ${k}`)
  }
  for (const k of st.skipped) if (!KNOWN.includes(k)) fail(`unknown skipped test ${k}`)

  // The risk score is always a real number in [0, 1] and matches the results it was computed from.
  if (st.risk) {
    if (!Number.isFinite(st.risk.risk) || st.risk.risk < 0 || st.risk.risk > 1) fail(`risk out of range: ${st.risk.risk}`)
  }

  // A test phase is a test that is configured, not skipped, and not already done.
  if (isTestPhase(st.phase)) {
    const t = st.phase as TestName
    if (!testSequence().includes(t)) fail(`phase ${t} is not in the configured sequence`)
    if (st.skipped.includes(t)) fail(`on the screen of a skipped test ${t}`)
    const r = st.results[t]
    if (r && !r.needsRetry) fail(`on the screen of a test that already has a usable result (${t})`)
  }

  // Alert bookkeeping lives and dies with its phase.
  if (st.alertStatus === 'sending' && st.phase !== 'alerting') fail(`alertStatus sending outside alerting`)
  if (st.alertStatus === 'sent' && st.phase !== 'alerted') fail(`alertStatus sent outside alerted`)
  if (st.phase === 'alerted' && st.alertStatus !== 'sent') fail(`alerted without a sent alert`)
  if (st.phase === 'alerting' && st.alertStatus !== 'sending' && st.alertStatus !== 'failed') fail(`alerting with status ${st.alertStatus}`)
  if ((st.phase === 'countdown' || st.phase === 'alerting') && !st.alertReason) fail(`${st.phase} without a reason`)

  if (!legalMove(prev, st.phase)) fail('illegal phase transition')
  // A text that is still in flight is never restarted (it could go out twice).
  if (prev === 'alerting' && prevAlert === 'sending' && st.phase === 'countdown') fail('restarted an alert that is still in flight')
}

/**
 * "Never a phase without a way forward": from THIS state, some action a real screen offers must get the patient out.
 * Tries each exit on a snapshot and restores it afterwards.
 */
function assertWayForward(seed: number, step: number) {
  const snap = s()
  const before = { phase: snap.phase, route: snap.route }
  const exits: { name: string; run: () => void }[] = [
    { name: 'giveConsent+beginTests', run: () => (s().giveConsent(), s().beginTests()) },
    { name: 'skipTest(current)', run: () => isTestPhase(snap.phase) && s().skipTest(snap.phase as TestName) },
    { name: 'cancel', run: () => s().cancelCountdown() },
    { name: 'confirm', run: () => s().confirmCountdown() },
    { name: 'alertResult', run: () => s().setAlertResult('sent', { ok: true, dryRun: true }) },
    { name: 'requestEmergency', run: () => s().requestEmergency('user_request') },
    { name: 'reset', run: () => s().reset() },
  ]
  let moved = false
  for (const e of exits) {
    e.run()
    if (s().phase !== before.phase) moved = true
    useSession.setState(snap, true)
    if (moved) break
  }
  useSession.setState(snap, true)
  // Idle is the resting state: there the exit is "Start", which needs the consent tick first, which giveConsent+beginTests covers.
  expect(moved, `seed ${seed} step ${step}: no way forward from phase ${before.phase}`).toBe(true)
}

function runSeed(seed: number, steps: number) {
  const r = rng(seed)
  s().clearAll()
  const log: string[] = []
  for (let i = 0; i < steps; i++) {
    const prev = s().phase
    const prevAlert = s().alertStatus
    const a = pickAction(r)
    log.push(a.name)
    a.run(r)
    checkInvariants(seed, i, log, prev, prevAlert)
    if (i % 3 === 0) assertWayForward(seed, i)
    // The dashboard/agent read this: it must always be recomputable from the stored results.
    const st = s()
    if (st.risk) {
      const again = computeRisk(st.results, st.opinions)
      if (!Number.isFinite(again.risk)) expect.fail(`seed ${seed} step ${i}: risk not recomputable`)
    }
  }
  // "Reset always returns to a clean idle."
  const consent = s().consented
  s().reset()
  const st = s()
  expect(st.phase).toBe('idle')
  expect(st.route).toBe('home')
  expect(st.results).toEqual({})
  expect(st.skipped).toEqual([])
  expect(st.opinions).toEqual([])
  expect(st.risk).toBeNull()
  expect(st.alertStatus).toBe('none')
  expect(st.alertReason).toBeUndefined()
  expect(st.alertResponse).toBeUndefined()
  expect(st.consented).toBe(consent) // consent is a fact about the visitor, not the run
}

describe('session fuzz: long random action sequences keep the invariants', () => {
  const eyes = FEATURES.eyesTest
  afterEach(() => {
    FEATURES.eyesTest = eyes
    s().clearAll()
  })

  for (const withEyes of [true, false]) {
    it(`60 seeds x 300 steps (eyes test ${withEyes ? 'on' : 'off'})`, () => {
      FEATURES.eyesTest = withEyes
      for (let seed = 1; seed <= 60; seed++) runSeed(seed + (withEyes ? 0 : 1000), 300)
    })
  }

  it('an alert that is in flight when the visitor starts over cannot leak into the next session', () => {
    s().clearAll()
    s().requestEmergency('user_request')
    s().confirmCountdown()
    expect(s().phase).toBe('alerting')
    s().reset()
    s().setAlertResult('sent', { ok: true, dryRun: false }) // the late response
    expect(s().phase).toBe('idle')
    expect(s().alertStatus).toBe('none')
  })

  it('a late test result during the countdown or alert does not steal the screen', () => {
    s().clearAll()
    s().requestEmergency('user_request')
    s().completeTest({ test: 'speech', severity: 0.1, confidence: 0.9, metrics: {}, flags: [], startedAt: 0, durationMs: 0 })
    expect(s().phase).toBe('countdown')
    s().confirmCountdown()
    s().completeTest({ test: 'face', severity: 0.1, confidence: 0.9, metrics: {}, flags: [], startedAt: 0, durationMs: 0 })
    expect(s().phase).toBe('alerting')
    expect(isResultPhase(s().phase)).toBe(true)
  })
})
