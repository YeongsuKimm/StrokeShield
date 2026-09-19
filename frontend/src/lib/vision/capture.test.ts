import { describe, expect, it } from 'vitest'
import { FRAMING_LIMITS } from '../config'
import type { TestName, TestResult } from '../contracts'
import { CAPTURE_TIMING as T, createArmsCapture, createFaceCapture, withYawGate, type CaptureController, type CaptureProgress } from './capture'

interface Fr {
  t: number
  missing?: boolean
}
const OK = { ok: true, hint: 'Good.' }
const BAD = { ok: false, hint: 'Move back a little.' }
const STEP = 50 // ms per tick (20 fps)

const okResult = (test: TestName): TestResult => ({
  test,
  severity: 0.1,
  confidence: 0.9,
  metrics: {},
  flags: [],
  startedAt: 1,
  durationMs: 0,
})

/** Drives a controller with a fake clock. `framing(t)` decides the framing verdict at each tick. */
function drive<F>(
  c: CaptureController<F>,
  makeFrame: (t: number) => F,
  framing: (t: number) => typeof OK | typeof BAD,
  untilMs: number,
  start = 0,
): { t: number; last?: CaptureProgress; seen: string[] } {
  const seen: string[] = []
  let last: CaptureProgress | undefined
  let t = start
  for (; t <= untilMs && !c.finished; t += STEP) {
    last = c.tick(t, { framing: framing(t), frame: makeFrame(t) })
    if (seen[seen.length - 1] !== last.phase) seen.push(last.phase)
  }
  return { t, last, seen }
}

const frame = (t: number): Fr => ({ t })

describe('FACE capture', () => {
  it('happy path: waits, holds framing, captures neutral then smile, then analyzes', () => {
    let got: { n: Fr[]; s: Fr[] } | undefined
    const c = createFaceCapture<Fr>((n, s) => {
      got = { n, s }
      return okResult('face')
    })
    const { seen, last } = drive(c, frame, () => OK, 20_000)
    expect(seen).toEqual(['waiting', 'neutral', 'smile', 'done'])
    expect(c.finished).toBe(true)
    expect(c.result?.needsRetry).toBeUndefined()
    expect(c.result?.severity).toBe(0.1)
    expect(c.result!.durationMs).toBeGreaterThan(T.faceNeutralMs + T.faceSmileMs)
    // frames at 20 fps (one every 50 ms) for each phase, give or take a couple at the edges
    const nExpected = T.faceNeutralMs / 50
    const sExpected = T.faceSmileMs / 50
    expect(got!.n.length).toBeGreaterThanOrEqual(nExpected - 2)
    expect(got!.n.length).toBeLessThanOrEqual(nExpected + 1)
    expect(got!.s.length).toBeGreaterThanOrEqual(sExpected - 2)
    expect(got!.s.length).toBeLessThanOrEqual(sExpected + 1)
    // buffers are disjoint and ordered
    expect(got!.n[got!.n.length - 1].t).toBeLessThan(got!.s[0].t)
    expect(last?.phase).toBe('done')
  })

  it('does not start capturing until framing has been OK for holdOkMs', () => {
    const c = createFaceCapture<Fr>(() => okResult('face'))
    const p1 = c.tick(0, { framing: OK, frame: frame(0) })
    expect(p1.phase).toBe('waiting')
    const p2 = c.tick(FRAMING_LIMITS.holdOkMs - 1, { framing: OK, frame: frame(1) })
    expect(p2.phase).toBe('waiting')
    // a blip resets the hold
    c.tick(FRAMING_LIMITS.holdOkMs, { framing: BAD, frame: frame(2) })
    const p3 = c.tick(FRAMING_LIMITS.holdOkMs + 100, { framing: OK, frame: frame(3) })
    expect(p3.phase).toBe('waiting')
    const p4 = c.tick(FRAMING_LIMITS.holdOkMs + 100 + FRAMING_LIMITS.holdOkMs, { framing: OK, frame: frame(4) })
    expect(p4.phase).toBe('neutral')
  })

  it('captions and countdown per phase', () => {
    const c = createFaceCapture<Fr>(() => okResult('face'))
    drive(c, frame, () => OK, FRAMING_LIMITS.holdOkMs + 100)
    let p = c.tick(FRAMING_LIMITS.holdOkMs + 150, { framing: OK, frame: frame(0) })
    expect(p.caption).toBe('Serious face, lips closed')
    expect(p.secondsLeft).toBe(Math.ceil(T.faceNeutralMs / 1000))
    p = c.tick(FRAMING_LIMITS.holdOkMs + 150 + T.faceNeutralMs + 50, { framing: OK, frame: frame(0) })
    expect(p.phase).toBe('smile')
    expect(p.caption).toBe('Now smile as big as you can and hold')
    expect(p.secondsLeft).toBe(Math.ceil(T.faceSmileMs / 1000))
  })

  it('framing never OK -> timeout retry result with a spoken flag', () => {
    let analyzed = false
    const c = createFaceCapture<Fr>(() => ((analyzed = true), okResult('face')))
    const { seen } = drive(c, frame, () => BAD, FRAMING_LIMITS.waitTimeoutMs + 1000)
    expect(seen).toEqual(['waiting', 'done'])
    expect(analyzed).toBe(false)
    expect(c.result?.needsRetry).toBe(true)
    expect(c.result?.confidence).toBe(0)
    expect(c.result?.flags[0]).toMatch(/couldn't see your face/i)
    expect(c.result?.test).toBe('face')
  })

  it('framing lost mid-capture for longer than the grace period -> retry', () => {
    const c = createFaceCapture<Fr>(() => okResult('face'))
    const smileStart = FRAMING_LIMITS.holdOkMs + T.faceNeutralMs
    // lost from 0.5 s into the smile capture, onwards (> framingLossGraceMs before the segment ends)
    const { seen } = drive(c, frame, (t) => (t >= smileStart + 500 ? BAD : OK), 20_000)
    expect(seen).toEqual(['waiting', 'neutral', 'smile', 'done'])
    expect(c.result?.needsRetry).toBe(true)
    expect(c.result?.flags[0]).toMatch(/lost sight/i)
  })

  it('a brief framing blip inside the grace period is tolerated; blip frames are not collected', () => {
    let got: Fr[] = []
    const c = createFaceCapture<Fr>((_n, s) => {
      got = s
      return okResult('face')
    })
    const smileStart = FRAMING_LIMITS.holdOkMs + T.faceNeutralMs
    const blip = (t: number) => (t >= smileStart + 1000 && t < smileStart + 1500 ? BAD : OK)
    drive(c, frame, blip, 20_000)
    expect(c.result?.needsRetry).toBeUndefined()
    expect(got.some((f) => f.t >= smileStart + 1050 && f.t < smileStart + 1500)).toBe(false)
    expect(got.length).toBeLessThan(T.faceSmileMs / 50)
  })

  it('unstable framing (coverage below minCoverage) -> retry even without one long loss', () => {
    const c = createFaceCapture<Fr>(() => okResult('face'))
    const cs = FRAMING_LIMITS.holdOkMs
    // in the smile capture alternate 1.2 s bad / 0.4 s ok: never hits the 1.5 s grace but coverage is 25 %
    const flaky = (t: number) => (t < cs + T.faceNeutralMs ? OK : (t - cs - T.faceNeutralMs) % 1600 < 400 ? OK : BAD)
    drive(c, frame, flaky, 20_000)
    expect(c.result?.needsRetry).toBe(true)
    expect(c.result?.flags[0]).toMatch(/steadily/i)
  })

  it('stores placeholder frames when nothing is detected (face detected-frame ratio)', () => {
    let neutral: Fr[] = []
    const c = createFaceCapture<Fr>(
      (n) => {
        neutral = n
        return okResult('face')
      },
      { missingFrame: (t) => ({ t, missing: true }) },
    )
    const neutralStart = FRAMING_LIMITS.holdOkMs
    for (let t = 0; t < 20_000 && !c.finished; t += STEP) {
      const gone = t >= neutralStart + 100 && t < neutralStart + 500 // 0.4 s with no face during the neutral capture
      c.tick(t, gone ? { framing: BAD, frame: null } : { framing: OK, frame: frame(t) })
    }
    expect(c.result?.needsRetry).toBeUndefined()
    expect(neutral.filter((f) => f.missing).length).toBeGreaterThanOrEqual(7)
    expect(neutral.filter((f) => !f.missing).length).toBeGreaterThanOrEqual(15)
  })

  it('cancellation returns a needsRetry "Cancelled." result and stops collecting', () => {
    let analyzed = false
    const c = createFaceCapture<Fr>(() => ((analyzed = true), okResult('face')))
    drive(c, frame, () => OK, FRAMING_LIMITS.holdOkMs + 500)
    c.cancel()
    expect(c.finished).toBe(true)
    expect(c.cancelled).toBe(true)
    expect(c.result?.needsRetry).toBe(true)
    expect(c.result?.flags[0]).toBe('Cancelled.')
    const p = c.tick(99_999, { framing: OK, frame: frame(0) })
    expect(p.phase).toBe('cancelled')
    expect(analyzed).toBe(false)
  })

  it('an analyze() that throws degrades to a retry result', () => {
    const c = createFaceCapture<Fr>(() => {
      throw new Error('boom')
    })
    drive(c, frame, () => OK, 20_000)
    expect(c.result?.needsRetry).toBe(true)
  })
})

describe('ARMS capture', () => {
  it('happy path: wait, 3-2-1 cue, 10 s hold, analyze on hold frames only', () => {
    let got: Fr[] = []
    const c = createArmsCapture<Fr>((f) => {
      got = f
      return okResult('arms')
    })
    const cueStart = FRAMING_LIMITS.holdOkMs
    const holdStart = cueStart + T.armsCueSeconds * 1000
    const { seen } = drive(c, frame, () => OK, 30_000)
    expect(seen).toEqual(['waiting', 'cue', 'hold', 'done'])
    expect(c.result?.needsRetry).toBeUndefined()
    expect(got.length).toBeGreaterThanOrEqual(199)
    expect(got.length).toBeLessThanOrEqual(201)
    expect(got[0].t).toBeGreaterThanOrEqual(holdStart)
    expect(got[got.length - 1].t - got[0].t).toBeLessThanOrEqual(T.armsHoldMs)
  })

  it('cue shows a 3-2-1 countdown', () => {
    const c = createArmsCapture<Fr>(() => okResult('arms'))
    drive(c, frame, () => OK, FRAMING_LIMITS.holdOkMs)
    const secs: number[] = []
    for (let t = FRAMING_LIMITS.holdOkMs + STEP; t < FRAMING_LIMITS.holdOkMs + 3000; t += 100) {
      const p = c.tick(t, { framing: OK, frame: frame(t) })
      if (p.phase === 'cue' && secs[secs.length - 1] !== p.secondsLeft) secs.push(p.secondsLeft ?? -1)
    }
    expect(secs).toEqual([3, 2, 1])
  })

  it('framing never OK within waitTimeoutMs -> retry flagged "couldn\'t see both hands"', () => {
    const c = createArmsCapture<Fr>(() => okResult('arms'))
    drive(c, frame, () => BAD, FRAMING_LIMITS.waitTimeoutMs + 500)
    expect(c.result?.needsRetry).toBe(true)
    expect(c.result?.flags[0]).toMatch(/both hands/i)
    expect(c.result?.test).toBe('arms')
  })

  it('patient steps out of frame during the cue -> back to waiting, then continues', () => {
    const c = createArmsCapture<Fr>(() => okResult('arms'))
    const cueStart = FRAMING_LIMITS.holdOkMs
    const framing = (t: number) => (t >= cueStart + 1000 && t < cueStart + 1300 ? BAD : OK)
    const { seen } = drive(c, frame, framing, 40_000)
    expect(seen).toEqual(['waiting', 'cue', 'waiting', 'cue', 'hold', 'done'])
    expect(c.result?.needsRetry).toBeUndefined()
  })

  it('arms drop out of frame mid-hold for > grace -> retry', () => {
    const c = createArmsCapture<Fr>(() => okResult('arms'))
    const holdStart = FRAMING_LIMITS.holdOkMs + T.armsCueSeconds * 1000
    const { seen } = drive(c, frame, (t) => (t >= holdStart + 4000 ? BAD : OK), 40_000)
    expect(seen).toEqual(['waiting', 'cue', 'hold', 'done'])
    expect(c.result?.needsRetry).toBe(true)
    expect(c.result?.flags[0]).toMatch(/lost sight/i)
  })

  it('does not collect when the pose is missing (no placeholder frames for arms)', () => {
    let got: Fr[] = []
    const c = createArmsCapture<Fr>((f) => {
      got = f
      return okResult('arms')
    })
    let t = 0
    const holdStart = FRAMING_LIMITS.holdOkMs + T.armsCueSeconds * 1000
    while (!c.finished && t < 40_000) {
      const gone = t >= holdStart + 2000 && t < holdStart + 2500
      c.tick(t, gone ? { framing: BAD, frame: null } : { framing: OK, frame: frame(t) })
      t += STEP
    }
    expect(c.result?.needsRetry).toBeUndefined()
    expect(got.some((f) => f.missing)).toBe(false)
    expect(got.length).toBeLessThan(200)
  })

  it('cancel during the hold', () => {
    const c = createArmsCapture<Fr>(() => okResult('arms'))
    drive(c, frame, () => OK, FRAMING_LIMITS.holdOkMs + T.armsCueSeconds * 1000 + 2000)
    expect(c.finished).toBe(false)
    c.cancel()
    expect(c.result?.flags[0]).toBe('Cancelled.')
  })
})

describe('withYawGate', () => {
  it('passes through when the head is straight or yaw is unknown', () => {
    expect(withYawGate(OK, 5, 15)).toBe(OK)
    expect(withYawGate(OK, -15, 15)).toBe(OK)
    expect(withYawGate(OK, undefined, 15)).toBe(OK)
  })
  it('blocks with a "look straight" hint when |yaw| exceeds the limit', () => {
    expect(withYawGate(OK, 20, 15)).toEqual({ ok: false, hint: 'Look straight at the screen.' })
    expect(withYawGate(OK, -12, 10).ok).toBe(false)
  })
  it('keeps the original hint when framing is already bad', () => {
    expect(withYawGate(BAD, 40, 15)).toBe(BAD)
  })
})

describe('intro card (face / eyes)', () => {
  it('shows only the instruction first: no framing wait, no measuring, then the normal flow', () => {
    const c = createFaceCapture<Fr>(() => okResult('face'), { introMs: 4000 })
    const early = c.tick(0, { framing: OK, frame: frame(0) })
    expect(early.phase).toBe('intro')
    expect(early.caption).toMatch(/serious, neutral face/i)
    expect(early.secondsLeft).toBe(4)
    // framing is perfect the whole time, yet nothing starts until the card has gone
    expect(c.tick(3900, { framing: OK, frame: frame(1) }).phase).toBe('intro')
    expect(c.tick(4100, { framing: OK, frame: frame(2) }).phase).toBe('waiting')
    expect(c.tick(4100 + FRAMING_LIMITS.holdOkMs + 50, { framing: OK, frame: frame(3) }).phase).toBe('neutral')
  })

  it('does not eat the framing-wait timeout while the card is up', () => {
    const c = createFaceCapture<Fr>(() => okResult('face'), { introMs: 4000 })
    c.tick(0, { framing: BAD, frame: null })
    c.tick(FRAMING_LIMITS.waitTimeoutMs - 500, { framing: BAD, frame: null }) // would have timed out without the intro
    expect(c.finished).toBe(false)
  })

  it('no intro when introMs is omitted (retries)', () => {
    const c = createFaceCapture<Fr>(() => okResult('face'))
    expect(c.tick(0, { framing: OK, frame: frame(0) }).phase).toBe('waiting')
  })
})
