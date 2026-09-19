// OWNER: Speech dev. Spec: docs/spec/03-speech.md
// TODO: implement actual recording logic (getUserMedia + MediaRecorder or AudioWorklet)
export async function recordSpeech(_maxSeconds = 6): Promise<Blob> {
  // Dummy implementation for now to satisfy the structure.
  console.log('Recording speech (stub)...')
  return new Blob([new Uint8Array([0, 0, 0, 0])], { type: 'audio/wav' })
}
