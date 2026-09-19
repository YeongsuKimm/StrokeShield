// OWNER: Speech dev. Spec: docs/spec/03-speech.md
// TODO: getUserMedia with echoCancellation/noiseSuppression/autoGainControl off,
// capture 16 kHz mono PCM16 and return a WAV Blob (auto-stop on trailing silence).
export async function recordSpeech(_maxSeconds = 6): Promise<Blob> {
  throw new Error('recordSpeech not implemented')
}
