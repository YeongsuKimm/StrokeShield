import { useEffect, useRef, type ReactNode } from 'react'
import { useSession } from '../lib/session/store'
import { isDebugSearch } from '../lib/vision/frameUtils'
import { useCaptureProgress } from '../lib/vision/progressStore'
import { useMediaPipe } from '../lib/vision/useMediaPipe'
import { DebugPanel } from './DebugPanel'
import { drawOverlay } from './overlayDraw'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'
import { Ring } from './ui/Primitives'

const DEBUG = isDebugSearch(globalThis.location?.search ?? '')

interface Props {
  /** Positioning outline (HeadGuide / BodyGuide). Hidden automatically once a timed capture is under way. */
  guide?: ReactNode
  /** Anything drawn over the video that is NOT mirrored — the eye-test dot, for instance. */
  overlay?: ReactNode
  /** Hide the guide during the capture itself, so it does not compete with the instruction. */
  hideGuideWhileCapturing?: boolean
}

// The live camera: MIRRORED video (CSS scaleX(-1)) + an overlay canvas that mirrors landmarks in the DRAW layer only
// (landmark math elsewhere is RAW/unmirrored). The frame reads as a dark viewfinder inset into the light page;
// its border carries the framing verdict (neutral → amber → green).
export function CameraView({ guide, overlay, hideGuideWhileCapturing = true }: Props) {
  const { engine, summary } = useMediaPipe()
  const progress = useCaptureProgress((s) => s.progress)
  const hint = useSession((s) => s.hint)
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Mount the engine's single <video> into this component.
  useEffect(() => {
    const host = hostRef.current
    const v = engine.video
    if (!host) return
    // objectFit 'fill' on purpose: the box already carries the video's own aspect ratio, and stretching (rather than
    // cropping) keeps normalized landmarks aligned with the overlay canvas even before the video size is known.
    Object.assign(v.style, { width: '100%', height: '100%', objectFit: 'fill', transform: 'scaleX(-1)', display: 'block' })
    host.prepend(v)
    return () => {
      if (v.parentElement === host) host.removeChild(v)
    }
  }, [engine])

  // Overlay loop: draws only when a new frame arrived or the canvas was resized. Keeps drawing out of React state.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let raf = 0
    let lastSeq = -1
    let dirty = true
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const { clientWidth: w, clientHeight: h } = canvas
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      dirty = true
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const snap = engine.latest
      if (snap.seq === lastSeq && !dirty) return
      lastSeq = snap.seq
      dirty = false
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const [w, h] = [canvas.width / dpr, canvas.height / dpr]
      ctx.clearRect(0, 0, w, h)
      drawOverlay(ctx, w, h, snap, { debug: DEBUG, connections: engine.connections })
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [engine])

  const aspect = summary.videoSize ? summary.videoSize.w / summary.videoSize.h : 16 / 9
  const framingOk = progress?.framingOk ?? false
  const ring = !progress ? 'ring-stage-2' : framingOk ? 'ring-ok' : 'ring-caution'
  const showCue = progress?.phase === 'cue' && progress.secondsLeft !== null
  const capturing = !!progress && ['neutral', 'smile', 'hold'].includes(progress.phase)
  const timed = progress && progress.secondsLeft !== null && progress.phase !== 'cue'
  const showGuide = guide && !(hideGuideWhileCapturing && capturing)

  return (
    <div className="on-stage">
      <div
        className={`relative w-full overflow-hidden rounded-[var(--radius-panel)] bg-stage ring-4 transition-shadow duration-500 ease-out ${ring}`}
        style={{ aspectRatio: aspect }}
      >
        <div ref={hostRef} className="absolute inset-0" />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

        {showGuide && <div className="absolute inset-0">{guide}</div>}
        {overlay}

        {/* Positioning hint, top centre. Amber while it is an instruction, green the moment framing is good. */}
        {hint && (
          <div className="absolute inset-x-3 top-3 flex justify-center">
            <p
              className="flex max-w-full items-center gap-2.5 rounded-full bg-caution px-5 py-3 text-center text-xl font-bold text-white shadow-[var(--shadow-lift)] sm:text-2xl"
              role="status"
            >
              <Icon name="alert" size={22} className="shrink-0" />
              {hint}
            </p>
          </div>
        )}
        {!hint && framingOk && !capturing && (
          <div className="absolute inset-x-3 top-3 flex justify-center">
            <p className="flex items-center gap-2.5 rounded-full bg-ok px-5 py-3 text-xl font-bold text-white shadow-[var(--shadow-lift)] sm:text-2xl">
              <Icon name="check" size={22} />
              Hold it right there
            </p>
          </div>
        )}

        {/* 3 · 2 · 1 */}
        {showCue && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span
              key={progress.secondsLeft}
              className="tnum text-[22vmin] font-bold leading-none text-white [text-shadow:0_4px_24px_rgba(0,0,0,0.75)] sm:text-[14rem]"
              style={{ animation: 'ss-rise 300ms var(--ease-out) both' }}
              aria-live="assertive"
            >
              {progress.secondsLeft}
            </span>
          </div>
        )}

        {/* Instruction caption + capture ring, bottom. Suppressed while merely waiting for position: the hint pill
            above and the page heading already say the same thing, and three copies of it is noise. */}
        {progress?.caption && progress.phase !== 'waiting' && (
          // The action prompt: big, solid and unmissable. Phases where the patient must DO something (smile, hold the
          // arms, follow the dot) get the accent colour; "relax" stays calm.
          <div
            className={`absolute inset-x-3 bottom-3 flex items-center justify-center gap-4 rounded-[var(--radius-panel)] px-5 py-4 shadow-[var(--shadow-lift)] ${
              progress.phase === 'neutral' ? 'bg-stage/95 text-stage-ink' : 'bg-accent text-white'
            }`}
          >
            {timed && <Ring fraction={progress.fraction} label={String(progress.secondsLeft)} size={56} stroke={5} tone="#ffffff" />}
            <p className="text-balance text-center text-2xl font-bold leading-tight sm:text-3xl" role="status">
              {progress.caption}
            </p>
          </div>
        )}

        {/* Camera not ready: never a bare spinner (docs/spec/06 "no blocking spinners > 3 s without status text"). */}
        {summary.status !== 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-stage/90 p-6 text-center backdrop-blur-sm">
            {summary.status === 'error' ? (
              <>
                <span className="flex size-12 items-center justify-center rounded-full bg-danger/20 text-danger-wash">
                  <Icon name="camera" size={24} />
                </span>
                <div>
                  <p className="text-lg font-semibold text-stage-ink">The camera did not start</p>
                  <p className="mt-1 max-w-sm text-[1rem] text-stage-ink-2">{summary.error?.message}</p>
                </div>
                <Button tone="stage" icon="refresh" onClick={() => engine.restart()}>
                  Try the camera again
                </Button>
                <p className="text-xs text-stage-ink-2">You can still skip this check, or add ?demo=1 to rehearse without a camera.</p>
              </>
            ) : (
              <>
                <span className="flex size-12 items-center justify-center rounded-full bg-white/10 text-stage-ink">
                  <Icon name="camera" size={24} className="breathe" />
                </span>
                <p className="text-[1rem] text-stage-ink-2">
                  {summary.status === 'starting' ? 'Starting the camera and loading the models…' : 'The camera is off.'}
                </p>
              </>
            )}
          </div>
        )}

        {DEBUG && (
          <p className="absolute bottom-3 right-3 rounded bg-stage/85 px-2 py-0.5 font-mono text-xs text-stage-ink-2">
            {summary.delegate ?? '-'} {summary.fps} fps
          </p>
        )}
      </div>
      {DEBUG && <DebugPanel />}
    </div>
  )
}
