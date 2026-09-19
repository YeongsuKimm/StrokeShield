import { useEffect, useRef } from 'react'
import { micMonitor } from '../../lib/media/micLevel'
import { rmsToBar } from '../../lib/speech/levelMeter'
import { useSpeechProgress } from '../../lib/speech/speechProgressStore'

/**
 * Live level meter for the speech check, drawn on a canvas — never through React state, so a 60 Hz signal costs no
 * re-renders (docs/spec/06 "Performance").
 *
 * TWO level sources, because either can be missing. The consent-time mic monitor only has a stream if the patient
 * pressed "Allow" on the home screen this session (a permission the browser already remembered never attaches it), and
 * the speech recorder opens its OWN stream and reports its level while listening. Using only the monitor left the wave
 * flat whenever the monitor had no stream. Each frame plots the louder of the two, so it moves whenever either hears you.
 */
export function Waveform({ active, height = 132 }: { active: boolean; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  // Mirrored into a ref so the draw loop can read it without being torn down and rebuilt on every toggle.
  const activeRef = useRef(active)
  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let raf = 0
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr))
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr))
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    const bars: number[] = new Array(micMonitor.history.length).fill(0)
    let lastPush = 0
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      // Roll the local history at ~30 Hz, mixing both sources (the recorder's raw RMS goes through a dB scale; see levelMeter.ts).
      if (now - lastPush >= 33) {
        lastPush = now
        const fromMonitor = micMonitor.history[micMonitor.history.length - 1] ?? 0
        const fromRecorder = activeRef.current ? rmsToBar(useSpeechProgress.getState().level) : 0
        bars.push(Math.max(fromMonitor, fromRecorder))
        bars.shift()
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const w = canvas.width / dpr
      const h = canvas.height / dpr
      ctx.clearRect(0, 0, w, h)

      const gap = 3
      const barW = Math.max(2, w / bars.length - gap)
      const mid = h / 2
      ctx.fillStyle = activeRef.current ? '#0b5cab' : '#c9c9c0'
      for (let i = 0; i < bars.length; i++) {
        // Silence rests at a visible pill rather than a hairline, so an idle mic reads as "waiting", not "broken".
        const amp = Math.max(barW / 2, bars[i] * (h * 0.46))
        const x = i * (barW + gap)
        ctx.beginPath()
        ctx.roundRect(x, mid - amp, barW, amp * 2, barW / 2)
        ctx.fill()
      }
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={ref}
      style={{ height }}
      className="w-full"
      role="img"
      aria-label={active ? 'Live microphone level while recording' : 'Microphone level'}
    />
  )
}
