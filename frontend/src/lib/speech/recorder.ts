// Speech recorder (docs/spec/03-speech.md, "Capture"). Opens its own raw microphone stream, feeds chunks to the VAD until
// the auto-stop rule fires (or maxSeconds / abort), then returns a 16 kHz mono PCM16 WAV plus capture QC.
//
// The DOM-facing part (getUserMedia, AudioContext, AudioWorklet) lives in ./micCapture.ts behind the tiny `MicCapture`
// interface, so everything in this file is unit-tested with a fake microphone.
import { SPEECH_CAPTURE, SPEECH_SAMPLE_RATE } from './config'
import { MicError, RecordingCancelled } from './micErrors'
import { openBrowserMic } from './micCapture'
import { assessQc, type SpeechQc } from './qc'
import { createSilenceDetector, speechWindow, type StopReason } from './vad'
import { concatFloat32, encodeWav, resample } from './wav'

export { MicError, RecordingCancelled } from './micErrors'

/** A running microphone: after `start`, `onChunk` gets consecutive mono Float32 chunks at `sampleRate`. */
export interface MicCapture {
  readonly sampleRate: number
  start: (onChunk: (chunk: Float32Array) => void, onError: (e: unknown) => void) => void
  /** Stop tracks and close the audio context. Must be safe to call more than once. */
  close: () => Promise<void> | void
}

export interface RecorderDeps {
  openCapture: () => Promise<MicCapture>
  /** Reject with MicError if the mic delivers no audio for this long after start. */
  stallTimeoutMs: number
}

export interface RecordSpeechOptions {
  maxSeconds?: number
  /** Called with the RMS (0..1) of every incoming chunk, for a level meter. */
  onLevel?: (rms: number) => void
  signal?: AbortSignal
}

export interface SpeechRecording {
  wav: Blob
  durationS: number
  sampleRate: 16000
  qc: SpeechQc
  /** Why recording ended (diagnostics / calibration). */
  stopReason: StopReason
}

const defaultDeps: RecorderDeps = { openCapture: openBrowserMic, stallTimeoutMs: 3000 }

export async function recordSpeech(opts: RecordSpeechOptions = {}, deps: RecorderDeps = defaultDeps): Promise<SpeechRecording> {
  const { signal } = opts
  if (signal?.aborted) throw new RecordingCancelled()
  const cap = await deps.openCapture()
  try {
    if (signal?.aborted) throw new RecordingCancelled()
    return await collect(cap, opts, deps.stallTimeoutMs)
  } finally {
    // Always release the microphone, also on abort or error.
    try {
      await cap.close()
    } catch (e) {
      console.debug('[speech] mic close failed', e)
    }
  }
}

function collect(cap: MicCapture, opts: RecordSpeechOptions, stallTimeoutMs: number): Promise<SpeechRecording> {
  const { signal, onLevel } = opts
  const maxSeconds = Math.min(opts.maxSeconds ?? SPEECH_CAPTURE.maxSeconds, SPEECH_CAPTURE.maxSeconds)
  const vad = createSilenceDetector(cap.sampleRate, { maxSeconds })
  const chunks: Float32Array[] = []

  return new Promise<SpeechRecording>((resolve, reject) => {
    let done = false
    let stall: ReturnType<typeof setTimeout> | undefined
    const finish = (fn: () => void) => {
      if (done) return
      done = true
      clearTimeout(stall)
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const onAbort = () => finish(() => reject(new RecordingCancelled()))
    const armStall = () => {
      clearTimeout(stall)
      stall = setTimeout(() => finish(() => reject(new MicError('unknown', 'The microphone is not delivering audio.'))), stallTimeoutMs)
    }

    signal?.addEventListener('abort', onAbort)
    armStall()
    try {
      cap.start((chunk) => {
        if (done) return
        armStall()
        chunks.push(chunk)
        const st = vad.push(chunk)
        onLevel?.(st.level)
        if (st.stop) {
          const reason = st.stop
          finish(() => {
            try {
              resolve(assemble(chunks, cap.sampleRate, vad.state, reason))
            } catch (e) {
              reject(e)
            }
          })
        }
      }, (e) => finish(() => reject(e instanceof MicError ? e : new MicError('unknown', String(e)))))
    } catch (e) {
      finish(() => reject(e))
    }
  })
}

function assemble(
  chunks: Float32Array[],
  captureRate: number,
  state: Parameters<typeof speechWindow>[0] & { elapsedS: number },
  stopReason: StopReason,
): SpeechRecording {
  // The last chunk can run past the frame where the VAD stopped: keep only the audio the VAD actually judged.
  const all = concatFloat32(chunks).subarray(0, Math.floor(state.elapsedS * captureRate + 1e-6))
  const [a, b] = speechWindow(state, captureRate, all.length)
  const clip = all.subarray(a, b)
  // Anti-aliased resample only when the AudioContext could not run at 16 kHz.
  const samples = captureRate === SPEECH_SAMPLE_RATE ? clip : resample(clip, captureRate, SPEECH_SAMPLE_RATE)
  const qc = assessQc(samples, state.speechStartS !== null)
  return {
    wav: new Blob([encodeWav(samples, SPEECH_SAMPLE_RATE)], { type: 'audio/wav' }),
    durationS: samples.length / SPEECH_SAMPLE_RATE,
    sampleRate: SPEECH_SAMPLE_RATE,
    qc,
    stopReason,
  }
}
