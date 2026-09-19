// Live microphone level, used for the "you're muted" warning the storyboard asks for on every test screen and for
// the speech waveform. One shared AnalyserNode: the stream is opened once at consent and reused.
import { rmsToBar } from '../speech/levelMeter'
import { useEffect, useState } from 'react'

/** Peak below this (0..1, linear) counts as silence. Roughly -46 dBFS: quiet room breathing stays under it. */
export const SILENCE_PEAK = 0.005
/** Silence must persist this long before we claim the mic is muted, so pauses between words don't trip it. */
export const SILENCE_GRACE_MS = 2500

export interface MicVerdict {
  /** True when the track is off, or nothing has been heard for SILENCE_GRACE_MS. */
  muted: boolean
  reason: 'track-off' | 'no-sound' | 'ok' | 'no-mic'
}

/**
 * PURE decision for the mute warning (docs/spec/06). `msSinceSound` is the time since the last peak above
 * SILENCE_PEAK. A hardware/OS mute usually shows up as `trackMuted`, a browser tab mute as `trackEnabled: false`,
 * and a muted headset as plain silence.
 */
export function evaluateMic(input: {
  hasStream: boolean
  trackEnabled: boolean
  trackMuted: boolean
  msSinceSound: number
}): MicVerdict {
  if (!input.hasStream) return { muted: true, reason: 'no-mic' }
  if (!input.trackEnabled || input.trackMuted) return { muted: true, reason: 'track-off' }
  if (input.msSinceSound >= SILENCE_GRACE_MS) return { muted: true, reason: 'no-sound' }
  return { muted: false, reason: 'ok' }
}

interface MonitorState {
  level: number // 0..1 smoothed peak, for the waveform
  verdict: MicVerdict
}

type Listener = (s: MonitorState) => void

class MicMonitor {
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private buf = new Float32Array(0)
  private raf = 0
  private lastSoundAt = 0
  private listeners = new Set<Listener>()

  state: MonitorState = { level: 0, verdict: { muted: true, reason: 'no-mic' } }

  /** Recent peaks, newest last, for the speech waveform. Fixed length so the bars don't reflow. */
  readonly history: number[] = new Array(64).fill(0)

  attach(stream: MediaStream): void {
    if (this.stream === stream) return
    this.detach()
    this.stream = stream
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor()
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 1024
      this.buf = new Float32Array(this.analyser.fftSize)
      this.source = this.ctx.createMediaStreamSource(stream)
      this.source.connect(this.analyser) // analyser only: never connect to the destination or the room will howl
      this.lastSoundAt = performance.now()
      this.loop()
    } catch (e) {
      console.debug('[micLevel] could not start the analyser', e)
      this.detach()
    }
  }

  detach(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.source?.disconnect()
    void this.ctx?.close().catch(() => {})
    this.source = null
    this.analyser = null
    this.ctx = null
    this.stream = null
    this.history.fill(0)
    this.publish({ level: 0, verdict: { muted: true, reason: 'no-mic' } })
  }

  /** Stop the microphone for good: stops the tracks (the browser's recording indicator goes off), then detaches. */
  release(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.detach()
  }

  /** Mute/unmute the outgoing track (used while the agent speaks, and by the mute button). */
  setEnabled(enabled: boolean): void {
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = enabled))
    if (enabled) this.lastSoundAt = performance.now()
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => this.listeners.delete(fn)
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop)
    const analyser = this.analyser
    if (!analyser) return
    analyser.getFloatTimeDomainData(this.buf)
    let peak = 0
    for (const v of this.buf) {
      const a = Math.abs(v)
      if (a > peak) peak = a
    }
    const now = performance.now()
    if (peak > SILENCE_PEAK) this.lastSoundAt = now

    const track = this.stream?.getAudioTracks()[0]
    const verdict = evaluateMic({
      hasStream: !!this.stream,
      trackEnabled: track?.enabled ?? false,
      trackMuted: track?.muted ?? false,
      msSinceSound: now - this.lastSoundAt,
    })

    // Smooth upward fast, downward slow: the bars follow speech without flickering.
    const level = peak > this.state.level ? peak : this.state.level * 0.86 + peak * 0.14
    this.history.push(rmsToBar(level)) // dB scale: raw-mic speech is quiet, a linear scale drew a near-flat wave
    this.history.shift()

    // React only needs ~15 Hz and only when something actually changed.
    const changed = Math.abs(level - this.state.level) > 0.004 || verdict.muted !== this.state.verdict.muted
    if (changed) this.publish({ level, verdict })
  }

  private publish(state: MonitorState): void {
    this.state = state
    for (const fn of this.listeners) fn(state)
  }
}

export const micMonitor = new MicMonitor()

/** React view of the monitor. Returns the smoothed level and the mute verdict. */
export function useMic(): MonitorState {
  const [state, setState] = useState<MonitorState>(micMonitor.state)
  useEffect(() => micMonitor.subscribe(setState), [])
  return state
}
