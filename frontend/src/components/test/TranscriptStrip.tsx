import { useEffect, useRef } from 'react'
import { useSession } from '../../lib/session/store'
import { smartQuotes, stripToneTags } from '../../lib/typography'
import { Icon } from '../ui/Icon'
import { pick, useLocale } from '../../lib/i18n'

/**
 * Captions of what the ElevenLabs assistant said, under the camera stage on every test screen. The spec calls for
 * on-screen captions as the backup when the voice connection is poor or the room is loud (docs/spec/04 "Latency").
 *
 * `useAgent` pushes each utterance through `useSession.getState().addTranscript(...)`; this strip only renders them.
 */
export function TranscriptStrip() {
  const locale = useLocale((s) => s.locale)
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
    <section aria-label={pick(locale, 'Assistant transcript', 'Transcripci\u00f3n de la gu\u00eda')} className="mt-4">
      <div className="mb-2 flex items-center gap-2">
        <span className={`size-2 rounded-full ${connected ? 'bg-ok breathe' : 'bg-ink-3'}`} aria-hidden />
        <p className="label-micro text-ink-3">{connected ? pick(locale, 'Assistant \u00b7 live', 'Gu\u00eda \u00b7 en vivo') : pick(locale, 'Assistant \u00b7 not connected', 'Gu\u00eda \u00b7 sin conexi\u00f3n')}</p>
      </div>

      <div
        ref={boxRef}
        role="log"
        aria-live="polite"
        // A scrollable box must be reachable by keyboard so older captions can be read; it also needs its own name.
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        aria-label={pick(locale, 'Conversation so far', 'Conversaci\u00f3n hasta ahora')}
        className="max-h-24 overflow-y-auto rounded-[var(--radius-control)] border border-line bg-surface px-4 py-3"
      >
        {transcript.length === 0 ? (
          <p className="flex items-center gap-2 text-[1rem] text-ink-3">
            <Icon name="waveform" size={17} />
            {pick(locale, 'What the assistant says appears here.', 'Lo que diga la gu\u00eda aparecer\u00e1 aqu\u00ed.')}
          </p>
        ) : (
          <div className="space-y-1.5">
            {transcript.map((line) => {
              const text = stripToneTags(line.text)
              if (!text) return null // a line that was only a tone tag has nothing to show
              const agent = line.speaker === 'agent'
              return (
                <p key={line.id} className="text-[1rem] leading-snug">
                  <span className={`label-micro mr-2 ${agent ? 'text-danger' : 'text-accent'}`}>{agent ? pick(locale, 'Assistant', 'Gu\u00eda') : pick(locale, 'You', 'T\u00fa')}</span>
                  <span className={agent ? 'text-ink' : 'text-ink-2'}>{smartQuotes(text)}</span>
                </p>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
