import { useEffect, useRef } from 'react'
import { useSession } from '../lib/session/store'
import { isDebugSearch } from '../lib/vision/frameUtils'
import { useCaptureProgress } from '../lib/vision/progressStore'
import { useMediaPipe } from '../lib/vision/useMediaPipe'
import { DebugPanel } from './DebugPanel'
import { drawOverlay } from './overlayDraw'

const DEBUG = isDebugSearch(globalThis.location?.search ?? '')

// The live camera: MIRRORED video (CSS scaleX(-1)) + an overlay canvas that mirrors landmarks in the DRAW layer only
// (landmark math elsewhere is RAW/unmirrored). Outline is green/red from the current framing verdict.
export function CameraView() {
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
  const outline = !progress ? 'border-slate-700' : progress.framingOk ? 'border-emerald-500' : 'border-red-500'
  const showCue = progress?.phase === 'cue' && progress.secondsLeft !== null
  const timed = progress && progress.secondsLeft !== null && progress.phase !== 'cue'

  return (
    <div className="space-y-2">
      <div
        className={`relative w-full overflow-hidden rounded-lg border-4 bg-black transition-colors ${outline}`}
        style={{ aspectRatio: aspect }}
      >
        <div ref={hostRef} className="absolute inset-0" />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

        {hint && (
          <p className="absolute left-2 right-2 top-2 rounded bg-black/70 px-3 py-1 text-center text-base font-medium text-amber-200">
            {hint}
          </p>
        )}

        {showCue && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-9xl font-bold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]" aria-live="assertive">
              {progress.secondsLeft}
            </span>
          </div>
        )}

        {progress?.caption && (
          <div className="absolute inset-x-2 bottom-2 flex items-center justify-center gap-3 rounded bg-black/70 px-3 py-2">
            {timed && <Ring fraction={progress.fraction} label={String(progress.secondsLeft)} />}
            <p className="text-lg font-semibold text-white" role="status">
              {progress.caption}
            </p>
          </div>
        )}

        {summary.status !== 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 p-4 text-center">
            {summary.status === 'error' ? (
              <>
                <p className="text-lg text-red-300">{summary.error?.message}</p>
                <button onClick={() => engine.restart()} className="rounded bg-sky-600 px-4 py-2">
                  Try camera again
                </button>
                <p className="text-xs text-slate-400">Demo mode (?demo=1) still works without a camera.</p>
              </>
            ) : (
              <p className="text-slate-200">{summary.status === 'starting' ? 'Starting camera and loading models…' : 'Camera is off.'}</p>
            )}
          </div>
        )}

        {DEBUG && (
          <p className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-0.5 font-mono text-xs text-slate-300">
            {summary.delegate ?? '-'} {summary.fps} fps
          </p>
        )}
      </div>
      {DEBUG && <DebugPanel />}
    </div>
  )
}

function Ring({ fraction, label }: { fraction: number; label: string }) {
  const r = 16
  const c = 2 * Math.PI * r
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" className="shrink-0" aria-hidden>
      <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="4" />
      <circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        stroke="#38bdf8"
        strokeWidth="4"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - fraction)}
        transform="rotate(-90 22 22)"
      />
      <text x="22" y="27" textAnchor="middle" fontSize="14" fill="white" fontWeight="bold">
        {label}
      </text>
    </svg>
  )
}
