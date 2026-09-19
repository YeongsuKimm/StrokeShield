// Browser-only microphone capture: getUserMedia + AudioContext + AudioWorklet (ScriptProcessor fallback).
// Deliberately thin and NOT unit-tested (no DOM in vitest); see the manual checklist in the speech report / docs.
// Importing this module never touches the DOM; everything happens inside openBrowserMic().
import { useSession } from '../session/store'
import { SPEECH_SAMPLE_RATE } from './config'
import { classifyMicError, MicError } from './micErrors'
import type { MicCapture } from './recorder'

// AudioWorklet processor, shipped as an inline Blob URL (no extra files). Batches 128-frame render quanta into ~1024
// sample chunks and transfers them to the main thread.
const WORKLET_SOURCE = `
class SsCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i]
        if (this.n === this.buf.length) {
          const out = this.buf
          this.port.postMessage(out, [out.buffer])
          this.buf = new Float32Array(1024)
          this.n = 0
        }
      }
    }
    return true
  }
}
registerProcessor('ss-capture', SsCapture)
`

// Raw signal on purpose: the backend measures jitter / shimmer / HNR, which AEC, noise suppression and AGC distort.
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
}

/** Open the microphone. Throws MicError (typed via classifyMicError) if it cannot. */
export async function openBrowserMic(): Promise<MicCapture> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
    throw new MicError('unsupported')
  }
  // Consent gate: the recording only opens after the visitor ticked the consent box (docs/spec/06 "Privacy").
  if (!useSession.getState().consented) throw new MicError('permission-denied')
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS })
  } catch (e) {
    throw new MicError(classifyMicError(e))
  }

  let ctx: AudioContext | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let sink: GainNode | null = null
  let node: AudioNode | null = null
  let blobUrl: string | null = null
  let closed = false

  const close = async () => {
    if (closed) return
    closed = true
    try {
      if (node) {
        if ('port' in node) (node as AudioWorkletNode).port.onmessage = null
        else (node as ScriptProcessorNode).onaudioprocess = null
      }
      node?.disconnect()
      source?.disconnect()
      sink?.disconnect()
    } catch {
      /* already disconnected */
    }
    for (const t of stream.getTracks()) t.stop()
    if (blobUrl) URL.revokeObjectURL(blobUrl)
    try {
      await ctx?.close()
    } catch {
      /* already closed */
    }
  }

  try {
    // Prefer a 16 kHz context so no resampling is needed. Some browsers (Firefox) refuse to connect a stream whose native
    // rate differs from the context's: fall back to the device rate and let the recorder resample.
    for (const rate of [SPEECH_SAMPLE_RATE, undefined]) {
      try {
        ctx = rate ? new AudioContext({ sampleRate: rate }) : new AudioContext()
        source = ctx.createMediaStreamSource(stream)
        break
      } catch (e) {
        await ctx?.close().catch(() => undefined)
        ctx = null
        source = null
        if (rate === undefined) throw e
      }
    }
    if (!ctx || !source) throw new MicError('unknown')
    if (ctx.state === 'suspended') await ctx.resume()
    const context = ctx
    const src = source
    sink = context.createGain()
    sink.gain.value = 0 // keeps the graph pulled by the destination without playing the mic through the speakers
    sink.connect(context.destination)

    let workletNode: AudioWorkletNode | null = null
    if (context.audioWorklet) {
      try {
        blobUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }))
        await context.audioWorklet.addModule(blobUrl)
        workletNode = new AudioWorkletNode(context, 'ss-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 })
      } catch (e) {
        console.debug('[speech] AudioWorklet unavailable, using ScriptProcessor', e)
      }
    }

    return {
      sampleRate: context.sampleRate,
      trackSettings: () => {
        const t = stream.getAudioTracks()[0]?.getSettings?.() ?? {}
        const flag = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined) // newer Chrome can report strings such as 'all'
        return { sampleRate: t.sampleRate ?? context.sampleRate, echoCancellation: flag(t.echoCancellation), noiseSuppression: flag(t.noiseSuppression), autoGainControl: flag(t.autoGainControl) }
      },
      start: (onChunk, onError) => {
        if (workletNode) {
          node = workletNode
          workletNode.port.onmessage = (ev: MessageEvent<Float32Array>) => onChunk(ev.data)
          workletNode.onprocessorerror = () => onError(new MicError('unknown', 'Audio capture failed.'))
        } else {
          // Deprecated but universally available fallback.
          const sp = context.createScriptProcessor(4096, 1, 1)
          sp.onaudioprocess = (ev) => onChunk(new Float32Array(ev.inputBuffer.getChannelData(0))) // copy: the buffer is reused
          node = sp
        }
        src.connect(node)
        node.connect(sink as GainNode)
        stream.getAudioTracks()[0]?.addEventListener('ended', () => onError(new MicError('mic-busy', 'The microphone was disconnected.')))
      },
      close,
    }
  } catch (e) {
    await close()
    throw e instanceof MicError ? e : new MicError(classifyMicError(e))
  }
}
