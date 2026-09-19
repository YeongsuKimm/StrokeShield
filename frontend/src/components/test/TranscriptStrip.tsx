import { useEffect, useRef } from 'react'
import { useSession } from '../../lib/session/store'
import { Icon } from '../ui/Icon'

/**
 * Captions of what the ElevenLabs assistant said, under the camera stage on every test screen. The spec calls for
 * on-screen captions as the backup when the voice connection is poor or the room is loud (docs/spec/04 "Latency").
 *
 * `useAgent` pushes each utterance through `useSession.getState().addTranscript(...)`; this strip only renders them.
 */
export function TranscriptStrip() {
  const transcript = useSession((s) => s.transcript)
  const connected = useSession((s) => s.agentConnected)
  const boxRef = useRef<HTMLDivElement>(null)

  // Follow the newest line by scrolling the strip's own box. `scrollIntoView` would also scroll the PAGE whenever
  // the strip sits below the fold, yanking the camera out of view on every new caption.
  useEffect(() => {
    const box = boxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [transcript.length])

  return (
    <section aria-label="Assistant transcript" className="mt-4">
      <div className="mb-2 flex items-center gap-2">
        <span className={`size-2 rounded-full ${connected ? 'bg-ok breathe' : 'bg-line-strong'}`} aria-hidden />
        <p className="label-micro text-ink-3">{connected ? 'Assistant · live' : 'Assistant · not connected'}</p>
      </div>

      <div
        ref={boxRef}
        role="log"
        aria-live="polite"
        className="max-h-24 overflow-y-auto rounded-[var(--radius-control)] border border-line bg-surface px-4 py-3"
      >
        {transcript.length === 0 ? (
          <p className="flex items-center gap-2 text-[1rem] text-ink-3">
            <Icon name="waveform" size={17} />
            What the assistant says appears here.
          </p>
        ) : (
          <div className="space-y-1.5">
            {transcript.map((line) => (
              <p key={line.id} className="text-[1rem] leading-snug">
                <span className="label-micro mr-2 text-ink-3">{line.speaker === 'agent' ? 'Assistant' : 'You'}</span>
                <span className={line.speaker === 'agent' ? 'text-ink' : 'text-ink-2'}>{line.text}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
