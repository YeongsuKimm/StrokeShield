// Microphone error classification (pure). Mirrors classifyCameraError in lib/vision/frameUtils.ts.

export type MicErrorKind = 'permission-denied' | 'no-microphone' | 'mic-busy' | 'unsupported' | 'muted' | 'unknown'

/** Map a getUserMedia / AudioContext failure to a typed kind the UI and the runner can show. */
export function classifyMicError(e: unknown): MicErrorKind {
  const name = (e as { name?: string } | null)?.name
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'permission-denied'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no-microphone'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'mic-busy'
    case 'TypeError':
      return 'unsupported'
    default:
      return 'unknown'
  }
}

export const MIC_ERROR_TEXT: Record<MicErrorKind, string> = {
  'permission-denied': 'Microphone permission was denied. Allow microphone access in the browser and try again.',
  'no-microphone': 'No microphone was found on this device.',
  'mic-busy': 'The microphone is in use by another app or tab.',
  unsupported: 'This browser cannot record audio here. Use a current Chrome, Edge, Firefox or Safari, and open the page over HTTPS (or localhost).',
  muted: 'The microphone looks muted or blocked. Check the mute switch on your headset or laptop, and the input device in your system sound settings.',
  unknown: 'Could not start the microphone.',
}

/** Thrown by the recorder when the microphone cannot be opened or stops delivering audio. */
export class MicError extends Error {
  readonly kind: MicErrorKind
  constructor(kind: MicErrorKind, message: string = MIC_ERROR_TEXT[kind]) {
    super(message)
    this.name = 'MicError'
    this.kind = kind
  }
}

/** Thrown by the recorder when its AbortSignal fires. */
export class RecordingCancelled extends Error {
  constructor() {
    super('Recording cancelled')
    this.name = 'RecordingCancelled'
  }
}
