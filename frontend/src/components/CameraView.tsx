import { useEffect, useRef, type ReactNode } from 'react'
import { captureAnnouncement } from '../lib/a11y/announce'
import { useThrottledAnnouncement } from '../lib/a11y/useA11y'
import { useSession } from '../lib/session/store'
import { smartQuotes } from '../lib/typography'
import { isDebugSearch } from '../lib/vision/frameUtils'
import { useCaptureProgress } from '../lib/vision/progressStore'
import { useMediaPipe } from '../lib/vision/useMediaPipe'
import { DebugPanel } from './DebugPanel'
import { drawOverlay } from './overlayDraw'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'
import { Ring } from './ui/Primitives'
import { pick, translateRuntimeText, useLocale } from '../lib/i18n'

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
  const locale = useLocale((s) => s.locale)
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
    // The live picture is for sighted users; the outline, hints and heading say everything a screen reader needs.
    v.setAttribute('aria-hidden', 'true')
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
  const ring = !progress ? 'ring-stage-2' : framingOk ? 'ring-ok-stage' : 'ring-caution'
  const showCue = progress?.phase === 'cue' && progress.secondsLeft !== null
  const capturing = !!progress && ['neutral', 'smile', 'hold'].includes(progress.phase)
  const timed = progress && progress.secondsLeft !== null && progress.phase !== 'cue'
  const showGuide = guide && !(hideGuideWhileCapturing && capturing)
  // The eyes and face checks are done close to the screen, so their prompts can be small; a big bar over a phone-sized
  // camera hides the very thing being measured, and in the eyes check it covered the moving dot. The arms check stays
  // large: the patient is several feet back, reading it from across the room.
  const compact = progress?.test === 'eyes' || progress?.test === 'face'

  // ONE polite live region speaks for the whole stage, at most once every 3 s: the intro / get-ready caption, the framing
  // hint, and the seconds left only on 5 s marks. The on-screen pills, digits and ring below are visual duplicates, so
  // they carry no live roles (the screen heading, in TestScreen, announces the main instruction changes).
  const spoken = !progress
    ? ''
    : progress.phase === 'intro'
      ? smartQuotes(translateRuntimeText(locale, progress.caption ?? ''))
      : progress.phase === 'cue'
        ? smartQuotes(translateRuntimeText(locale, progress.caption ?? ''))
        : hint
          ? smartQuotes(translateRuntimeText(locale, hint))
          : capturing || timed
            ? captureAnnouncement('', progress.secondsLeft)
            : framingOk
              ? pick(locale, 'Hold it right there', 'Mantente justo ah\u00ed')
              : ''
  const announced = useThrottledAnnouncement(spoken)

  return (
    <div className="on-stage">
      <div
        className={`relative mx-auto w-full overflow-hidden rounded-[var(--radius-panel)] bg-stage ring-4 transition-shadow duration-500 ease-out ${ring}`}
        style={{ aspectRatio: aspect, maxWidth: `calc(var(--cam-max-h) * ${aspect})` }}
      >
        <div ref={hostRef} className="absolute inset-0" />
        <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
        <p role="status" className="sr-only">
          {announced}
        </p>

        {showGuide && <div className="absolute inset-0">{guide}</div>}
        {overlay}

        {/* Top of the camera: the "SMILE!" cue, then the positioning hint, stacked in one column so they can never sit
            on top of each other (they used to share the same corner). Amber while it is an instruction, green the
            moment framing is good. Kept short and small for the close-up checks: see `compact` above. */}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col items-center gap-2">
          {/* The moment the relax timer ends and the smile is due, so the change of phase is impossible to miss. */}
          {progress?.test === 'face' && progress.phase === 'smile' && (
            <p className="pop rounded-full bg-accent px-5 py-1.5 text-2xl font-extrabold tracking-wide text-white shadow-[var(--shadow-lift)] sm:text-3xl">
              {pick(locale, 'SMILE!', '\u00a1SONR\u00cdE!')}
            </p>
          )}
          {hint && progress?.phase !== 'intro' && (
            <p
              className={`flex max-w-full items-center rounded-full bg-caution text-center font-semibold text-white shadow-[var(--shadow-lift)] ${
                compact ? 'gap-2 px-3.5 py-1.5 text-base leading-snug' : 'gap-2.5 px-5 py-3 text-xl sm:text-2xl'
              }`}
            >
              <Icon name="alert" size={compact ? 16 : 22} className="shrink-0" />
              {smartQuotes(translateRuntimeText(locale, hint))}
            </p>
          )}
          {!hint && framingOk && !capturing && progress?.phase !== 'intro' && (
            <p
              className={`flex items-center rounded-full bg-ok font-semibold text-white shadow-[var(--shadow-lift)] ${
                compact ? 'gap-2 px-3.5 py-1.5 text-base' : 'gap-2.5 px-5 py-3 text-xl sm:text-2xl'
              }`}
            >
              <Icon name="check" size={compact ? 16 : 22} />
              {pick(locale, 'Hold it right there', 'Mantente justo ah\u00ed')}
            </p>
          )}
        </div>

        {/* Instruction card, dead centre, before anything is measured (face / eyes). It is the ONLY thing asked of the
            patient during this beat, so it is big and solid; the check starts by itself when it goes away. */}
        {progress?.phase === 'intro' && progress.caption && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div
              className="pop max-w-[26rem] rounded-[var(--radius-panel)] bg-accent px-5 py-4 text-center text-white shadow-[var(--shadow-lift)]"
            >
              <p className="text-balance text-xl font-semibold leading-snug sm:text-2xl">{smartQuotes(translateRuntimeText(locale, progress.caption))}</p>
              <p className="mt-2 text-[0.9375rem] font-medium text-white/85">{pick(locale, `Starting in ${progress.secondsLeft}\u2026`, `Comienza en ${progress.secondsLeft}\u2026`)}</p>
            </div>
          </div>
        )}

        {/* 3 · 2 · 1 */}
        {showCue && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span
              key={progress.secondsLeft}
              className="tnum text-[22vmin] font-semibold leading-none text-white [text-shadow:0_4px_24px_rgba(0,0,0,0.75)] sm:text-[14rem]"
              style={{ animation: 'ss-rise 300ms var(--ease-out) both' }}
              aria-hidden
            >
              {progress.secondsLeft}
            </span>
          </div>
        )}

        {/* Instruction caption + capture ring, bottom. Suppressed while merely waiting for position: the hint pill
            above and the page heading already say the same thing, and three copies of it is noise. */}
        {progress?.caption && progress.phase !== 'waiting' && progress.phase !== 'intro' && (
          // The action prompt: big, solid and unmissable. Phases where the patient must DO something (smile, hold the
          // arms, follow the dot) get the accent colour; "relax" stays calm.
          <div
            className={`absolute inset-x-3 bottom-3 flex items-center justify-center rounded-[var(--radius-panel)] shadow-[var(--shadow-lift)] ${
              compact ? 'gap-2.5 px-3 py-2' : 'gap-4 px-5 py-4'
            } ${progress.phase === 'neutral' ? 'bg-stage/95 text-stage-ink' : 'bg-accent text-white'}`}
          >
            {timed && (
              <Ring
                fraction={progress.fraction}
                label={String(progress.secondsLeft)}
                size={compact ? 36 : 56}
                stroke={compact ? 4 : 5}
                tone="#ffffff"
              />
            )}
            <p className={`text-balance text-center font-semibold ${compact ? 'text-base leading-snug sm:text-lg' : 'text-2xl leading-tight sm:text-3xl'}`}>
              {smartQuotes(translateRuntimeText(locale, progress.caption))}
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
                <div role="alert">
                  <p className="text-lg font-semibold text-stage-ink">{pick(locale, 'The camera did not start', 'La c\u00e1mara no se inici\u00f3')}</p>
                  <p className="mt-1 max-w-sm text-[1rem] text-stage-ink-2">{smartQuotes(summary.error?.message ?? '')}</p>
                </div>
                <Button tone="stage" icon="refresh" onClick={() => engine.restart()}>
                  {pick(locale, 'Try the camera again', 'Intentar con la c\u00e1mara de nuevo')}
                </Button>
                <p className="text-xs text-stage-ink-2">{pick(locale, 'You can still skip this check, or add ?demo=1 to rehearse without a camera.', 'Puedes omitir esta revisi\u00f3n o a\u00f1adir ?demo=1 para ensayar sin c\u00e1mara.')}</p>
              </>
            ) : (
              <>
                <span className="flex size-12 items-center justify-center rounded-full bg-white/10 text-stage-ink">
                  <Icon name="camera" size={24} className="breathe" />
                </span>
                <p className="text-[1rem] text-stage-ink-2">
                  {summary.status === 'starting' ? pick(locale, 'Starting the camera and loading the models\u2026', 'Iniciando la c\u00e1mara y cargando los modelos\u2026') : pick(locale, 'The camera is off.', 'La c\u00e1mara est\u00e1 apagada.')}
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
