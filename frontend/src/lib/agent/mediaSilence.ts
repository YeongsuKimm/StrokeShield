// Silencing the voice agent on iOS.
//
// The speech gate (speechAudioGate.ts) sets the agent's playback volume to 0 while the patient's own voice is being
// recorded. On iOS that does nothing: Safari ignores any programmatic `volume` on a media element, by design, because
// volume there belongs to the hardware buttons. The agent would carry on talking into the room and land inside the
// recording we are about to analyse for slurring.
//
// `muted` IS honoured on iOS, on every media element, so the gate mutes the elements themselves as well. This is
// deliberately element-level rather than SDK-level: the voice SDK owns its audio element and does not expose it, and
// this app plays no other sound, so "mute what is playing" is both safe and enough. Every element is restored to the
// value it had, so our own already-muted camera <video> is left exactly as it was.

type MediaRoot = Pick<Document, 'querySelectorAll'>

/** Mute every media element on the page. Returns a function that puts each one back the way it was. */
export function muteAllMedia(root: MediaRoot = document): () => void {
  let previous: [HTMLMediaElement, boolean][] = []
  try {
    previous = [...root.querySelectorAll<HTMLMediaElement>('audio, video')].map((el) => [el, el.muted])
    for (const [el] of previous) el.muted = true
  } catch (e) {
    // A locked-down or torn-down document: there is nothing to silence, and this must never break the recording.
    console.debug('[agent] could not mute media elements', e)
  }
  return () => {
    for (const [el, was] of previous) {
      try {
        el.muted = was
      } catch (e) {
        console.debug('[agent] could not restore a media element', e)
      }
    }
    previous = []
  }
}
