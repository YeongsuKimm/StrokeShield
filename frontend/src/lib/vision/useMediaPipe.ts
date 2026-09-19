// Live-camera runtime: webcam + MediaPipe FaceLandmarker/PoseLandmarker in VIDEO mode (docs/spec/02-vision.md "Runtime").
//
// * `VisionEngine` is a plain class (one shared instance via `getVisionEngine()`); it owns the <video>, the
//   requestAnimationFrame loop (~20 fps) and the landmarkers. Per-frame data lives in `engine.latest` and is pushed to
//   subscribers (`subscribeFrames`); React only gets a small `VisionSummary` at <= 5 Hz (`useMediaPipe`).
// * Landmarks are RAW (unmirrored) image coordinates. The <video> is mirrored by CSS in CameraView; only drawing mirrors.
// * Assets are local: wasm from /mediapipe-wasm (copied from node_modules by scripts/copy-mediapipe-wasm.mjs) and models
//   from /models (public/models/, see README there). Nothing is fetched from a CDN.
// * NOT verifiable without a browser/camera: GPU delegate, model loading, blendshape names, yaw sign, left/right.
import { useEffect, useSyncExternalStore } from 'react'
import type { FaceLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision'
import { useSession } from '../session/store'
import { watchTracksEnded } from '../media/permissions'
import { currentBrowser } from '../preflight/browserSupport'
import type { FaceFrame, PoseFrame } from './landmarks'
import {
  CAMERA_ENDED_TEXT,
  CAMERA_ERROR_TEXT,
  buildFaceFrame,
  buildPoseFrame,
  classifyCameraError,
  faceRegion,
  meanLuminance,
  nextTimestamp,
  type CameraErrorKind,
} from './frameUtils'
import { faceBox, poseBox, selectSubject, SubjectTracker, type SubjectInfo } from './subject'

const BASE = import.meta.env?.BASE_URL ?? '/'
export const WASM_BASE = `${BASE}mediapipe-wasm`
export const FACE_MODEL = `${BASE}models/face_landmarker.task`
export const POSE_MODEL = `${BASE}models/pose_landmarker_lite.task`

const TARGET_FPS = 20
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS
const SUMMARY_MIN_INTERVAL_MS = 200 // <= 5 Hz into React
const BRIGHTNESS_EVERY_N_FRAMES = 4
const BRIGHTNESS_SIZE = { w: 32, h: 18 }
const MAX_CONSECUTIVE_FAILURES = 15
const STOP_DELAY_MS = 500 // survive React StrictMode's mount/unmount/mount
const MODEL_LOAD_TIMEOUT_MS = 45_000 // wasm/model fetch that never settles (offline, blocked file) => a clean error, not a hang
const NUM_SUBJECTS = 2 // ask the landmarkers for two faces/bodies so a bystander can be told apart and ignored (subject.ts)
const LOAD_TIMEOUT = new Error('model load timed out')
export const MODEL_LOAD_FAILED_TEXT =
  'The face/pose models could not load. Check the connection and reload; you can also skip this check.'

export type VisionStatus = 'idle' | 'starting' | 'ready' | 'error'
export type VisionErrorKind = CameraErrorKind | 'model-load-failed' | 'inference-failed'

export interface VisionError {
  kind: VisionErrorKind
  message: string
}

/** Everything the latest processed frame produced. Raw (unmirrored) coordinates. */
/**
 * What to ask the camera for. Phones are held in PORTRAIT for the whole check, and that is what decides this:
 *
 * - **3:4 portrait, not 16:9.** The arm check needs the patient's whole arm span to fit ACROSS the frame. A 16:9
 *   stream rotated into portrait is 9:16, by far the narrowest view a phone can give, and the framing gate would
 *   never pass at any sensible distance in a room. 3:4 is both wider and usually the sensor's full field of view.
 * - **Smaller and slower.** A 720x960 stream at 24 fps is enough for landmarks and leaves a mid-range phone the
 *   headroom to run two models; 1280x720 at whatever fps it can manage does not.
 *
 * Everything downstream reads the REAL `videoWidth / videoHeight` (see `aspect` on each snapshot), so a portrait
 * stream is measured correctly without any other change. Desktop is deliberately untouched.
 */
export function cameraConstraints(mobile = currentBrowser().ios || currentBrowser().android): MediaTrackConstraints {
  return mobile
    ? { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 }, frameRate: { ideal: 24, max: 30 } }
    : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
}

export interface VisionSnapshot {
  seq: number // increments per processed frame
  t: number // performance.now() ms, strictly increasing
  face: FaceFrame | null // null = no face detected (or the face detector is off)
  pose: PoseFrame | null
  /** Mean frame luminance, 0..255 (matches FaceCaptureFrame.brightness). */
  brightness: number
  /** video.videoWidth / video.videoHeight (needed for true angles: landmarks are normalized per axis). */
  aspect: number
  /** Who is in view (the frame above is always the ONE tracked subject). Omitted by fake sources in tests. */
  subject?: SubjectInfo
}

/** Low-rate summary for React state (<= 5 Hz). */
export interface VisionSummary {
  status: VisionStatus
  error: VisionError | null
  delegate: 'GPU' | 'CPU' | null
  fps: number
  faceDetected: boolean
  poseDetected: boolean
  brightness: number
  videoSize: { w: number; h: number } | null
}

export interface Connection {
  start: number
  end: number
}

export interface Detectors {
  face: boolean
  pose: boolean
}

/** What useTestRunner needs from the runtime (also lets tests inject a fake camera). */
export interface FrameSource {
  readonly latest: VisionSnapshot
  readonly summary: VisionSummary
  /** Ref-counted: the camera runs while at least one holder exists. Returns the release function. */
  acquire(): () => void
  subscribeFrames(fn: (s: VisionSnapshot) => void): () => void
  subscribeSummary(fn: () => void): () => void
  /** Resolves when models + camera are ready, or with a reason on error/timeout. */
  waitUntilReady(timeoutMs: number): Promise<{ ok: true } | { ok: false; reason: string }>
  setDetectors(d: Partial<Detectors>): void
  /** Optional: re-open the camera/models after an error (the runner calls it before a fresh attempt). */
  restart?(): void
}

const EMPTY_SNAPSHOT: VisionSnapshot = { seq: 0, t: 0, face: null, pose: null, brightness: 0, aspect: 16 / 9 }
const INITIAL_SUMMARY: VisionSummary = {
  status: 'idle',
  error: null,
  delegate: null,
  fps: 0,
  faceDetected: false,
  poseDetected: false,
  brightness: 0,
  videoSize: null,
}

export class VisionEngine implements FrameSource {
  latest: VisionSnapshot = EMPTY_SNAPSHOT
  summary: VisionSummary = INITIAL_SUMMARY
  /** Filled once the models load: drawing connections for the overlay (face contours, pose skeleton). */
  connections: { face: Connection[]; pose: Connection[] } = { face: [], pose: [] }

  private _video: HTMLVideoElement | undefined
  private stream: MediaStream | undefined
  private unwatchTracks: (() => void) | undefined
  private face: FaceLandmarker | undefined
  private pose: PoseLandmarker | undefined
  private detectors: Detectors = { face: true, pose: true }
  private raf = 0
  private gen = 0 // bumps on stop(); async start steps abort if it changed
  private refs = 0
  private stopTimer: ReturnType<typeof setTimeout> | undefined
  private lastRun = 0
  private lastTs = 0
  private lastVideoTime = -1
  private seq = 0
  private failures = 0
  private rebuilding = false
  private fpsCount = 0
  private fpsSince = 0
  private brightnessCanvas: HTMLCanvasElement | undefined
  private frameListeners = new Set<(s: VisionSnapshot) => void>()
  private summaryListeners = new Set<() => void>()
  private summaryTimer: ReturnType<typeof setTimeout> | undefined
  private lastSummaryEmit = 0
  private faceTracker = new SubjectTracker()
  private poseTracker = new SubjectTracker()
  private region: { sx: number; sy: number; sw: number; sh: number } | null = null

  /** The single shared <video> (muted, playsInline). CameraView mounts it into the page. */
  get video(): HTMLVideoElement {
    if (!this._video) {
      const v = document.createElement('video')
      v.muted = true
      v.playsInline = true
      v.autoplay = true
      this._video = v
    }
    return this._video
  }

  acquire(): () => void {
    this.refs++
    if (this.stopTimer) {
      clearTimeout(this.stopTimer)
      this.stopTimer = undefined
    }
    if (this.summary.status === 'idle') void this.start()
    let released = false
    return () => {
      if (released) return
      released = true
      this.refs--
      if (this.refs <= 0) this.stopTimer = setTimeout(() => this.stop(), STOP_DELAY_MS)
    }
  }

  setDetectors(d: Partial<Detectors>): void {
    this.detectors = { ...this.detectors, ...d }
  }

  subscribeFrames(fn: (s: VisionSnapshot) => void): () => void {
    this.frameListeners.add(fn)
    return () => this.frameListeners.delete(fn)
  }

  subscribeSummary = (fn: () => void): (() => void) => {
    this.summaryListeners.add(fn)
    return () => this.summaryListeners.delete(fn)
  }

  waitUntilReady(timeoutMs: number): Promise<{ ok: true } | { ok: false; reason: string }> {
    const check = (): { ok: true } | { ok: false; reason: string } | null => {
      if (this.summary.status === 'ready') return { ok: true }
      if (this.summary.status === 'error') return { ok: false, reason: this.summary.error?.message ?? 'camera error' }
      return null
    }
    const now = check()
    if (now) return Promise.resolve(now)
    return new Promise((resolve) => {
      const done = (r: { ok: true } | { ok: false; reason: string }) => {
        clearTimeout(timer)
        off()
        resolve(r)
      }
      const off = this.subscribeSummary(() => {
        const r = check()
        if (r) done(r)
      })
      const timer = setTimeout(() => done({ ok: false, reason: 'camera/models took too long to load' }), timeoutMs)
    })
  }

  /**
   * Start camera + models. Safe to call repeatedly; use `restart()` after an error. Every await is followed by a generation
   * check and each step only ever releases what THIS run created, so a stale start (stop()/restart() while it was still
   * loading) can never close the hardware or models of the run that replaced it.
   */
  async start(): Promise<void> {
    if (this.summary.status === 'starting' || this.summary.status === 'ready') return
    const gen = ++this.gen
    this.setSummary({ status: 'starting', error: null }, true)
    try {
      if (!(await this.openCamera(gen))) return
    } catch (e) {
      if (gen !== this.gen) return
      const kind = classifyCameraError(e)
      console.debug('[vision] camera failed', kind, e)
      this.releaseHardware()
      this.setSummary({ status: 'error', error: { kind, message: CAMERA_ERROR_TEXT[kind] } }, true)
      return
    }
    try {
      const loaded = await this.withTimeout(this.loadModels('GPU', gen), gen)
      if (!loaded) return
    } catch (e) {
      if (gen !== this.gen && e !== LOAD_TIMEOUT) return
      console.debug('[vision] model load failed', e)
      this.releaseHardware()
      this.setSummary({ status: 'error', error: { kind: 'model-load-failed', message: MODEL_LOAD_FAILED_TEXT } }, true)
      return
    }
    this.failures = 0
    this.lastVideoTime = -1
    this.fpsSince = performance.now()
    this.fpsCount = 0
    this.setSummary({ status: 'ready', error: null }, true)
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(this.loop)
  }

  restart(): void {
    this.stop()
    void this.start()
  }

  /** Stop tracks, cancel the loop, close the landmarkers. */
  stop(): void {
    this.gen++
    if (this.stopTimer) clearTimeout(this.stopTimer)
    this.stopTimer = undefined
    cancelAnimationFrame(this.raf)
    this.releaseHardware()
    this.latest = EMPTY_SNAPSHOT
    this.lastVideoTime = -1
    this.rebuilding = false
    this.region = null
    this.faceTracker.reset()
    this.poseTracker.reset()
    this.setSummary({ ...INITIAL_SUMMARY }, true)
  }

  private releaseHardware(): void {
    this.unwatchTracks?.() // our own stop() must not look like the camera dying
    this.unwatchTracks = undefined
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = undefined
    if (this._video) this._video.srcObject = null
    this.face?.close()
    this.pose?.close()
    this.face = undefined
    this.pose = undefined
  }

  /** Resolves false when this run was superseded (its stream is stopped here); throws on a real camera failure. */
  private async openCamera(gen: number): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no mediaDevices'), { name: 'TypeError' })
    const stream = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(), audio: false })
    if (gen !== this.gen) {
      stream.getTracks().forEach((t) => t.stop())
      return false
    }
    this.stream = stream
    const v = this.video
    v.srcObject = stream
    await v.play()
    if (gen !== this.gen) return false // stop() already released this.stream
    // Permission revoked mid-test, camera unplugged or taken by another app: the frames just freeze, so say so and
    // offer "Try the camera again" / skip instead of leaving a dead picture. (`stop()` detaches its own tracks first.)
    this.unwatchTracks?.()
    this.unwatchTracks = watchTracksEnded(stream, () => {
      if (gen !== this.gen || this.stream !== stream) return
      console.debug('[vision] camera track ended')
      cancelAnimationFrame(this.raf)
      this.setSummary({ status: 'error', error: { kind: 'unknown', message: CAMERA_ENDED_TEXT } }, true)
    })
    return true
  }

  /** Reject a load that never settles; the late result is discarded (its generation is invalidated, so it closes itself). */
  private withTimeout(p: Promise<boolean>, gen: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (gen !== this.gen) return resolve(false) // superseded meanwhile: not this run's problem any more
        this.gen++ // invalidate the pending load: it will close whatever it eventually creates
        reject(LOAD_TIMEOUT)
      }, MODEL_LOAD_TIMEOUT_MS)
      p.then(
        (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        (e) => {
          clearTimeout(timer)
          reject(e)
        },
      )
    })
  }

  /**
   * GPU first, CPU fallback (also used for the mid-run CPU rebuild). Resolves false when superseded while loading: the
   * freshly created landmarkers are closed and NOT installed.
   */
  private async loadModels(preferred: 'GPU' | 'CPU', gen: number): Promise<boolean> {
    const mp = await import('@mediapipe/tasks-vision')
    const fileset = await mp.FilesetResolver.forVisionTasks(WASM_BASE)
    const order: ('GPU' | 'CPU')[] = preferred === 'GPU' ? ['GPU', 'CPU'] : ['CPU']
    let lastErr: unknown
    for (const delegate of order) {
      let face: FaceLandmarker | undefined
      let pose: PoseLandmarker | undefined
      try {
        face = await mp.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: FACE_MODEL, delegate },
          runningMode: 'VIDEO',
          numFaces: NUM_SUBJECTS,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        })
        pose = await mp.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: POSE_MODEL, delegate },
          runningMode: 'VIDEO',
          numPoses: NUM_SUBJECTS,
        })
        if (gen !== this.gen) {
          face.close()
          pose.close()
          return false
        }
        this.face?.close()
        this.pose?.close()
        this.face = face
        this.pose = pose
        this.connections = {
          face: mp.FaceLandmarker.FACE_LANDMARKS_CONTOURS,
          pose: mp.PoseLandmarker.POSE_CONNECTIONS,
        }
        this.setSummary({ delegate })
        console.debug('[vision] models ready, delegate =', delegate)
        return true
      } catch (e) {
        lastErr = e
        face?.close()
        pose?.close()
        console.debug('[vision] landmarker init failed with', delegate, e)
      }
    }
    throw lastErr
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop)
    const v = this._video
    if (!v || !this.face || !this.pose || this.rebuilding) return
    if (v.readyState < 2 || v.videoWidth === 0 || v.currentTime === this.lastVideoTime) return
    const now = performance.now()
    if (now - this.lastRun < FRAME_INTERVAL_MS - 4) return
    this.lastRun = now
    this.lastVideoTime = v.currentTime
    const ts = (this.lastTs = nextTimestamp(this.lastTs, now))

    let face: FaceFrame | null = null
    let pose: PoseFrame | null = null
    let subject: SubjectInfo | undefined
    try {
      // Several people: pick ONE subject (largest/most central, then sticky) and read landmarks, blendshapes and the yaw
      // matrix at that one index. Bystanders are counted for the "one person at a time" hint, never measured.
      if (this.detectors.face) {
        const res = this.face.detectForVideo(v, ts)
        const sel = selectSubject(this.faceTracker, res.faceLandmarks, faceBox, ts)
        face = sel.index === null ? null : buildFaceFrame(res, ts, sel.index)
        subject = { bystanders: sel.bystanders, ambiguous: sel.ambiguous, epoch: sel.epoch }
        this.region = face ? faceRegion(faceBox(face.landmarks), v.videoWidth, v.videoHeight) : null
      }
      if (this.detectors.pose) {
        const res = this.pose.detectForVideo(v, ts)
        const sel = selectSubject(this.poseTracker, res.landmarks, poseBox, ts)
        pose = sel.index === null ? null : buildPoseFrame(res, ts, sel.index)
        subject ??= { bystanders: sel.bystanders, ambiguous: sel.ambiguous, epoch: sel.epoch }
      }
      this.failures = 0
    } catch (e) {
      this.onDetectFailure(e)
      return
    }

    this.seq++
    const brightness = this.seq % BRIGHTNESS_EVERY_N_FRAMES === 1 ? this.measureBrightness(v) : this.latest.brightness
    this.latest = { seq: this.seq, t: ts, face, pose, brightness, aspect: v.videoWidth / v.videoHeight, subject }
    for (const fn of this.frameListeners) {
      try {
        fn(this.latest)
      } catch (e) {
        console.debug('[vision] frame listener threw', e)
      }
    }

    this.fpsCount++
    if (now - this.fpsSince >= 1000) {
      this.setSummary({ fps: Math.round((this.fpsCount * 1000) / (now - this.fpsSince)) })
      this.fpsCount = 0
      this.fpsSince = now
    }
    this.setSummary({
      faceDetected: face !== null,
      poseDetected: pose !== null,
      brightness: Math.round(brightness),
      videoSize: { w: v.videoWidth, h: v.videoHeight },
    })
  }

  private onDetectFailure(e: unknown): void {
    this.failures++
    console.debug('[vision] detect failed', this.failures, e)
    if (this.failures === 3 && this.summary.delegate === 'GPU') {
      // The GPU delegate initialised but doesn't actually run: rebuild on CPU once.
      this.rebuilding = true
      const gen = this.gen
      this.loadModels('CPU', gen)
        .then((installed) => {
          if (installed && gen === this.gen) this.failures = 0
        })
        .catch((err) => console.debug('[vision] CPU rebuild failed', err))
        .finally(() => {
          this.rebuilding = false
        })
    } else if (this.failures >= MAX_CONSECUTIVE_FAILURES && !this.rebuilding) {
      cancelAnimationFrame(this.raf) // stop hammering a dead detector; "Try the camera again" restarts everything
      this.setSummary({ status: 'error', error: { kind: 'inference-failed', message: 'Face/pose detection keeps failing.' } }, true)
    }
  }

  private measureBrightness(v: HTMLVideoElement): number {
    try {
      if (!this.brightnessCanvas) {
        this.brightnessCanvas = document.createElement('canvas')
        this.brightnessCanvas.width = BRIGHTNESS_SIZE.w
        this.brightnessCanvas.height = BRIGHTNESS_SIZE.h
      }
      const ctx = this.brightnessCanvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return this.latest.brightness
      // The subject's face when it is known (backlight: bright window, dark face), else the whole frame.
      const r = this.region
      if (r) ctx.drawImage(v, r.sx, r.sy, r.sw, r.sh, 0, 0, BRIGHTNESS_SIZE.w, BRIGHTNESS_SIZE.h)
      else ctx.drawImage(v, 0, 0, BRIGHTNESS_SIZE.w, BRIGHTNESS_SIZE.h)
      return meanLuminance(ctx.getImageData(0, 0, BRIGHTNESS_SIZE.w, BRIGHTNESS_SIZE.h).data)
    } catch {
      return this.latest.brightness
    }
  }

  private setSummary(patch: Partial<VisionSummary>, immediate = false): void {
    const next = { ...this.summary, ...patch }
    if ((Object.keys(patch) as (keyof VisionSummary)[]).every((k) => Object.is(next[k], this.summary[k]) || shallowEq(next[k], this.summary[k]))) {
      return
    }
    this.summary = next
    const wait = this.lastSummaryEmit + SUMMARY_MIN_INTERVAL_MS - performance.now()
    if (immediate || wait <= 0) return this.emitSummary()
    this.summaryTimer ??= setTimeout(() => this.emitSummary(), wait)
  }

  private emitSummary(): void {
    clearTimeout(this.summaryTimer)
    this.summaryTimer = undefined
    this.lastSummaryEmit = performance.now()
    for (const fn of this.summaryListeners) fn()
  }
}

const shallowEq = (a: unknown, b: unknown): boolean => {
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  const [ka, kb] = [Object.keys(a), Object.keys(b)]
  return ka.length === kb.length && ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

let shared: VisionEngine | undefined
/** The one shared engine (lazy: nothing touches the DOM until first use). */
export const getVisionEngine = (): VisionEngine => (shared ??= new VisionEngine())

/**
 * React hook: keeps the camera + models running while mounted (ref-counted) and returns the engine plus a
 * low-rate (<= 5 Hz) summary. Per-frame data: read `engine.latest` / `engine.subscribeFrames`, not React state.
 */
export function useMediaPipe(): { engine: VisionEngine; summary: VisionSummary } {
  const engine = getVisionEngine()
  // Consent gate: the camera only opens once the visitor has ticked the consent box, and closes if they withdraw it.
  const consented = useSession((s) => s.consented)
  useEffect(() => (consented ? engine.acquire() : undefined), [engine, consented])
  const summary = useSyncExternalStore(engine.subscribeSummary, () => engine.summary)
  return { engine, summary }
}
