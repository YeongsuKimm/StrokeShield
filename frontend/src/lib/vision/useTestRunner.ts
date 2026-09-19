// Connects live frames (useMediaPipe) + the capture controller (capture.ts) + the pure analyzers + the session store.
//
// Non-React entry points (what the ElevenLabs client tools call; do NOT edit lib/agent/* from here):
//   import { testRunner } from '../vision/useTestRunner'
//   start_face_test: async () => summarize(await testRunner.runFace())
//   start_arm_test:  async () => summarize(await testRunner.runArms())
// Both return Promise<TestResult>: they always resolve (never reject), including camera/model failure, framing timeout
// and cancel (all `needsRetry: true`, spoken-style `flags[0]`). Non-cancelled results are also stored via
// useSession.completeTest. Calling the same run twice returns the in-flight promise; a different run cancels the first.
//
// React entry point: `useTestRunner()` returns the same functions plus `running` for button state.
import { recordRun } from '../calibration/recorder'
import { useCaptureProgress, type RunnableTest } from './progressStore'
import { useSession } from '../session/store'
import type { TestResult } from '../contracts'
import { analyzeArms } from './arms'
import { analyzeEyes, EYES_CONFIG } from './eyes'
import { labelEyeFrames } from './eyeProtocol'
import { analyzeFace, FACE_CONFIG, type FaceCaptureFrame } from './face'
import {
  CAPTURE_TIMING,
  CaptureController,
  createArmsCapture,
  createEyesCapture,
  createFaceCapture,
  retryResult,
  withYawGate,
  type CaptureProgress,
} from './capture'
import { checkArmFraming, checkFaceFraming, type Framing } from './framing'
import type { PoseFrame } from './landmarks'
import { ONE_PERSON_HINT, SWITCHED_PERSON_HINT } from './subject'
import { getVisionEngine, type FrameSource, type VisionSnapshot } from './useMediaPipe'

// ---- ADAPTERS ------------------------------------------------------------------------------------------------------
// The only place that knows the analyzers' call signatures. If analyzeFace/analyzeArms change, fix ONE line here.
export type FaceAnalyzer = (neutral: FaceCaptureFrame[], smile: FaceCaptureFrame[]) => TestResult
export type ArmsAnalyzer = (frames: PoseFrame[], aspectRatio: number) => TestResult
/** `windowStartT` = when the capture window (and so the dot protocol) began, on the frames' clock. */
export type EyesAnalyzer = (frames: FaceCaptureFrame[], aspectRatio: number, windowStartT?: number) => TestResult
const analyzeFaceAdapter: FaceAnalyzer = (neutral, smile) => analyzeFace(neutral, smile)
const analyzeArmsAdapter: ArmsAnalyzer = (frames, aspectRatio) => analyzeArms(frames, { aspectRatio })
// --------------------------------------------------------------------------------------------------------------------

const READY_TIMEOUT_MS = 60_000 // camera permission + model load
const HEARTBEAT_MS = 250 // keeps timeouts/hints alive if the camera stalls
const STALE_FRAME_MS = 400
const PUBLISH_MS = 200 // progress -> React at <= 5 Hz (immediately on phase/framing changes)

export interface RunnerDeps {
  /** Lazy so importing this module never touches the DOM. */
  source: () => FrameSource
  analyzeFace: FaceAnalyzer
  analyzeArms: ArmsAnalyzer
  analyzeEyes: EyesAnalyzer
  completeTest: (r: TestResult) => void
  setHint: (h?: string) => void
  publish: (running: RunnableTest | null, p: CaptureProgress | null) => void
  now: () => number
  faceYawLimitDeg: number
  eyesYawLimitDeg: number
}

const defaultDeps = (): RunnerDeps => ({
  source: getVisionEngine,
  // Wrapped so `?record=1` can save the exact analyzer inputs (lib/calibration); recordRun is a no-op otherwise.
  analyzeFace: (neutral, smile) => {
    const result = analyzeFaceAdapter(neutral, smile)
    recordRun({ kind: 'face', neutral, smile }, result)
    return result
  },
  analyzeArms: (frames, aspectRatio) => {
    const result = analyzeArmsAdapter(frames, aspectRatio)
    recordRun({ kind: 'arms', frames, aspectRatio }, result)
    return result
  },
  analyzeEyes: (frames, aspectRatio, windowStartT) => {
    // The capture window and EyeStimulus start together, so the WINDOW start (not the first collected frame, which is
    // later when the first frames were unusable) anchors the target protocol. The sync error is one camera frame
    // against 1-2 second dot segments. Save these exact labelled analyzer inputs.
    const labelled = labelEyeFrames(frames, windowStartT ?? frames[0]?.t ?? 0)
    const result = analyzeEyes(labelled, { aspect: aspectRatio })
    recordRun({ kind: 'eyes', frames: labelled, aspect: aspectRatio }, result)
    return result
  },
  completeTest: (r) => useSession.getState().completeTest(r),
  setHint: (h) => useSession.getState().setHint(h),
  publish: (running, p) => useCaptureProgress.getState().set(running, p),
  now: () => performance.now(),
  faceYawLimitDeg: FACE_CONFIG.yawFullDeg,
  eyesYawLimitDeg: EYES_CONFIG.maxYawDeg,
})

/** Checks whose instruction card has already been shown this session (cleared when the session returns to idle). */
const introDone = new Set<RunnableTest>()
useSession.subscribe((st) => {
  if (st.phase === 'idle') introDone.clear()
})

export interface TestRunner {
  runFace: () => Promise<TestResult>
  runArms: () => Promise<TestResult>
  runEyes: () => Promise<TestResult>
  cancel: () => void
  readonly running: RunnableTest | null
}

export function createTestRunner(overrides: Partial<RunnerDeps> = {}): TestRunner {
  const deps = { ...defaultDeps(), ...overrides }
  let current: {
    token: symbol
    test: RunnableTest
    promise: Promise<TestResult>
    cancel: () => void
    cancelRequested: boolean
  } | null = null

  async function execute(test: RunnableTest, cancelled: Promise<void>, controllerRef: { c?: CaptureController<unknown> }) {
    const source = deps.source()
    const startedAt = Date.now()
    const failure = (reason: string) => retryResult(test, reason, startedAt, 0)
    const release = source.acquire()
    let unsub = () => {}
    let unsubSummary = () => {}
    let heartbeat: ReturnType<typeof setInterval> | undefined
    try {
      // Face and eyes only need the face landmarker, arms only the pose landmarker (saves CPU/GPU).
      source.setDetectors(test === 'arms' ? { face: false, pose: true } : { face: true, pose: false })
      // A camera stuck in 'error' (permission dismissed, GPU/inference failure) never recovers by itself while the
      // screen holds it open, so every fresh attempt (auto-retry or Try again) must reopen it or it fails identically.
      if (source.summary.status === 'error') source.restart?.()
      deps.publish(test, {
        test,
        phase: 'waiting',
        caption: 'Starting the camera…',
        hint: '',
        secondsLeft: null,
        fraction: 0,
        framingOk: false,
      })
      const ready = await Promise.race([source.waitUntilReady(READY_TIMEOUT_MS), cancelled.then(() => null)])
      if (ready === null) return retryResult(test, 'Cancelled.', startedAt, 0)
      if (!ready.ok) return failure(`I couldn't start the camera. ${ready.reason}`)

      // The instruction card is shown once per check per session: an automatic or manual retry goes straight back in.
      const introMs = test !== 'arms' && !introDone.has(test) ? CAPTURE_TIMING.introMs : 0
      const controller = (
        test === 'face'
          ? createFaceCapture<FaceCaptureFrame>((n, s) => deps.analyzeFace(n, s), {
              introMs,
              missingFrame: (t) => ({ landmarks: [], blendshapes: {}, t, brightness: source.latest.brightness, aspect: source.latest.aspect }),
            })
          : test === 'eyes'
            ? createEyesCapture<FaceCaptureFrame>((f, info) => deps.analyzeEyes(f, source.latest.aspect, info.segmentStarts[0]), {
                introMs,
                // A frame with no face inside the window is kept as an empty frame so the analyzer can count and name it.
                missingFrame: (t) => ({ landmarks: [], blendshapes: {}, t, brightness: source.latest.brightness, aspect: source.latest.aspect }),
              })
            : createArmsCapture<PoseFrame>((f) => deps.analyzeArms(f, source.latest.aspect))
      ) as CaptureController<unknown>
      controllerRef.c = controller

      return await new Promise<TestResult>((resolve) => {
        let lastPublish = 0
        let lastKey = ''
        let lastFrameAt = deps.now()
        let lastPhase: CaptureProgress['phase'] = 'waiting'
        let runEpoch: number | undefined // which person this run is measuring (see subject.ts)
        let lastPublishedPhase = ''

        const step = (snap: VisionSnapshot | null) => {
          const now = snap ? snap.t : deps.now()
          if (snap) lastFrameAt = now
          const yawLimit = test === 'eyes' ? deps.eyesYawLimitDeg : deps.faceYawLimitDeg
          let input: { framing: Framing; frame: FaceCaptureFrame | PoseFrame | null; captureOk?: boolean } = snap
            ? inputFor(test, snap, yawLimit)
            : { framing: NO_CAMERA, frame: null, captureOk: undefined }
          if (snap?.subject) {
            // The person being measured is fixed when the capture begins. If the tracker hands the view to someone else
            // mid-run, those frames are treated as lost (never mixed into the analysis).
            if (lastPhase === 'intro' || lastPhase === 'waiting' || runEpoch === undefined) runEpoch = snap.subject.epoch
            else if (snap.subject.epoch !== runEpoch) input = { framing: { ok: false, hint: SWITCHED_PERSON_HINT }, frame: null, captureOk: false }
          }
          const p = controller.tick(now, input)
          lastPhase = p.phase
          // Counted as shown only once it has actually run its course (a cancelled early mount must not use it up).
          if (introMs > 0 && p.phase !== 'intro') introDone.add(test)
          const key = `${p.phase}|${p.framingOk}|${p.hint}|${p.secondsLeft}`
          // <= 5 Hz into React whatever the frame rate: a phase change or the end publishes at once, everything else
          // (a hint flickering at the framing threshold, the countdown) waits for the next 200 ms slot.
          const phaseKey = `${p.phase}|${controller.finished}`
          const urgent = phaseKey !== lastPublishedPhase
          if ((key !== lastKey && (urgent || now - lastPublish >= PUBLISH_MS)) || now - lastPublish >= PUBLISH_MS) {
            lastKey = key
            lastPublish = now
            lastPublishedPhase = phaseKey
            deps.publish(test, p)
            deps.setHint(p.hint || undefined)
          }
          if (controller.finished) resolve(controller.result!)
        }

        unsub = source.subscribeFrames((s) => step(s))
        // The camera died or the detector gave up mid-run (unplugged, permission revoked, inference failing): end the run
        // NOW with the reason, instead of waiting out the timeouts on a frozen picture.
        unsubSummary = source.subscribeSummary(() => {
          if (source.summary.status === 'error' && !controller.finished) {
            resolve(failure(`I lost the camera. ${source.summary.error?.message ?? ''}`.trim()))
          }
        })
        heartbeat = setInterval(() => {
          if (deps.now() - lastFrameAt > STALE_FRAME_MS) step(null)
        }, HEARTBEAT_MS)
        void cancelled.then(() => {
          controller.cancel()
          resolve(controller.result!)
        })
        step(null)
      })
    } finally {
      unsub()
      unsubSummary()
      clearInterval(heartbeat)
      source.setDetectors({ face: true, pose: true })
      release()
    }
  }

  function start(test: RunnableTest): Promise<TestResult> {
    // Join an in-flight run of the same test, but never one that was already told to cancel: it would resolve
    // 'Cancelled.' and the caller (retry press, agent tool) would get no fresh attempt.
    if (current?.test === test && !current.cancelRequested) return current.promise
    const previous = current
    previous?.cancel()

    let cancelFn = () => {}
    const cancelled = new Promise<void>((r) => (cancelFn = r))
    const controllerRef: { c?: CaptureController<unknown> } = {}
    const token = Symbol(test)
    const entry = {
      token,
      test,
      cancelRequested: false,
      cancel: () => {
        entry.cancelRequested = true
        cancelFn()
      },
      promise: (async () => {
        await previous?.promise.catch(() => undefined) // let the previous run release the camera first
        let result: TestResult
        try {
          try {
            result = await execute(test, cancelled, controllerRef)
          } catch (e) {
            // Never leave the runner wedged: an unexpected camera/engine error becomes an ordinary retry result, so the
            // screen shows "Try again" and the next attempt starts clean (this used to freeze the retry button for good).
            console.warn('[runner] capture crashed', e)
            result = retryResult(test, "Something went wrong with the camera. Let's try again.", Date.now(), 0)
          }
          // A cancelled run resolves with a 'Cancelled.' retry result and is NOT stored.
          const wasCancelled = controllerRef.c ? controllerRef.c.cancelled : result.flags[0] === 'Cancelled.'
          try {
            if (!wasCancelled) deps.completeTest(result)
            deps.setHint(wasCancelled ? undefined : result.needsRetry ? result.flags[0] : undefined)
          } catch (e) {
            console.warn('[runner] storing the result failed', e)
          }
        } finally {
          // ALWAYS release the slot and the progress state, whatever happened above.
          if (current?.token === token) {
            current = null
            deps.publish(null, null)
          }
        }
        return result
      })(),
    }
    current = entry
    return entry.promise
  }

  return {
    runFace: () => start('face'),
    runArms: () => start('arms'),
    runEyes: () => start('eyes'),
    cancel: () => current?.cancel(),
    get running() {
      return current?.test ?? null
    },
  }
}

const NO_CAMERA: Framing = { ok: false, hint: "I can't get the camera image." }

/**
 * Two people about the same size in view: we cannot know whom to test, so the run waits (with a hint) rather than guess.
 * A smaller bystander is ignored by the tracker and only adds a gentle reminder.
 */
function onePerson(framing: Framing, snap: VisionSnapshot): Framing {
  const sub = snap.subject
  if (!sub) return framing
  if (sub.ambiguous) return { ok: false, hint: ONE_PERSON_HINT }
  if (framing.ok && sub.bystanders > 0) return { ok: true, hint: 'Good. Hold still. Only one person in view, please.' }
  return framing
}

function inputFor(
  test: RunnableTest,
  snap: VisionSnapshot,
  yawLimitDeg: number,
): { framing: Framing; frame: FaceCaptureFrame | PoseFrame | null; captureOk?: boolean } {
  if (test === 'arms') return { framing: onePerson(checkArmFraming(snap.pose?.landmarks ?? null), snap), frame: snap.pose }
  // Face and eyes share the close-up face gate; only the yaw limit differs (eyes need a stiller head).
  const face = snap.face
  // brightness (0..255) and aspect (video w/h) ride along on every face frame, as analyzeFace expects.
  const frame: FaceCaptureFrame | null = face ? { ...face, brightness: snap.brightness, aspect: snap.aspect } : null
  const base = onePerson(checkFaceFraming(face?.landmarks ?? null), snap)
  const framing = withYawGate(base, face?.yawDeg, yawLimitDeg)
  // Eyes: the yaw gate only guards the START (and shows a live "look straight" hint); inside the window a turned head
  // does not fail the run, the analyzer rejects those frames and names the cause.
  return { framing, frame, captureOk: test === 'eyes' ? base.ok : undefined }
}

let shared: TestRunner | undefined
/** The shared runner for non-React callers (ElevenLabs client tools). */
export const testRunner: TestRunner = {
  runFace: () => (shared ??= createTestRunner()).runFace(),
  runArms: () => (shared ??= createTestRunner()).runArms(),
  runEyes: () => (shared ??= createTestRunner()).runEyes(),
  cancel: () => shared?.cancel(),
  get running() {
    return shared?.running ?? null
  },
}

/** React hook: same functions plus `running` ('face' | 'arms' | 'eyes' | null) for button state. */
export function useTestRunner(): Pick<TestRunner, 'runFace' | 'runArms' | 'runEyes' | 'cancel'> & {
  running: RunnableTest | null
} {
  const running = useCaptureProgress((s) => s.running)
  return {
    runFace: testRunner.runFace,
    runArms: testRunner.runArms,
    runEyes: testRunner.runEyes,
    cancel: testRunner.cancel,
    running,
  }
}
