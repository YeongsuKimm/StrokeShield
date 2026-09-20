// Guides drawn over the camera stage so the patient can see where to stand before anything is measured
// (docs/spec/06 "The camera view should show a 'stand here' guide").
//
// Geometry note: these are sized against FRAMING_LIMITS in lib/config.ts.
//  - The head oval is sized as a percentage of the frame WIDTH (38%), because `checkFaceFraming` gates on face width
//    as a fraction of frame width (18–60%). It is laid out in CSS rather than an SVG viewBox for exactly that reason:
//    a square viewBox would anchor to the frame's height and land near the bottom of the gate on a wide camera.
//  - The body guide is anchored to the frame HEIGHT, which is the right reference for a standing person, and its
//    shoulders span about 22% of the width — comfortably above the 9% shoulder-width minimum, so a patient who
//    fills the outline is far enough back for both wrists to stay in frame.
// Both live in the MIRRORED layer; they are symmetric, so mirroring does not matter.
import type { ReactNode } from 'react'
import { pick, useLocale } from '../../lib/i18n'

type GuideTone = 'waiting' | 'ok'

const STROKE: Record<GuideTone, string> = { waiting: 'rgba(255,255,255,0.8)', ok: 'var(--color-ok-stage)' }

/** Viewfinder corner ticks around a box given in percentages of the stage. */
function Ticks({ inset, color }: { inset: { x: number; y: number }; color: string }) {
  const corners = [
    { left: `${inset.x}%`, top: `${inset.y}%`, rotate: '0deg' },
    { right: `${inset.x}%`, top: `${inset.y}%`, rotate: '90deg' },
    { right: `${inset.x}%`, bottom: `${inset.y}%`, rotate: '180deg' },
    { left: `${inset.x}%`, bottom: `${inset.y}%`, rotate: '270deg' },
  ]
  return (
    <>
      {corners.map((c, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute size-5 border-l-2 border-t-2 transition-colors duration-300"
          style={{ ...c, borderColor: color, transform: `rotate(${c.rotate})`, borderTopLeftRadius: 4 }}
        />
      ))}
    </>
  )
}

function Layer({ children, label }: { children: ReactNode; label: string }) {
  // The drawing is decorative (aria-hidden); the same words are available as text for screen readers.
  return (
    <>
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {children}
      </div>
      <p className="sr-only">{label}</p>
    </>
  )
}

/** Dashed oval for the close-up checks (speech, eyes, face): "put your head here". */
export function HeadGuide({ tone = 'waiting' }: { tone?: GuideTone }) {
  const locale = useLocale((s) => s.locale)
  const color = STROKE[tone]
  return (
    <Layer label={pick(locale, 'Outline showing where to place your head', 'Contorno que muestra dónde colocar la cabeza')}>
      <div
        className="absolute left-1/2 top-[46%] w-[38%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 border-dashed transition-colors duration-300"
        style={{ borderColor: color, aspectRatio: '3 / 4' }}
      />
      <Ticks inset={{ x: 27, y: 14 }} color={color} />
    </Layer>
  )
}

/** Head, shoulders and torso for the arms check: "step back until you fill this". */
export function BodyGuide({ tone = 'waiting' }: { tone?: GuideTone }) {
  const locale = useLocale((s) => s.locale)
  const color = STROKE[tone]
  return (
    <Layer label={pick(locale, 'Outline showing where to stand for the arm check', 'Contorno que muestra dónde colocarse para la revisión de brazos')}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <g
          fill="none"
          stroke={color}
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transition: 'stroke 300ms var(--ease-out)' }}
        >
          {/* Proportions of a real upper body: the head is about a third as wide as the shoulders (roughly 23 vs 60
              units), the neck is short and narrow, and the torso tapers a little towards the waist. */}
          <g transform="translate(0 4)">
          <ellipse strokeDasharray="4 5" cx="50" cy="25" rx="11.5" ry="14" />
          <path
            strokeDasharray="4 5"
            d="M45.5 38.5V45C37 46.5 27 48 22.5 52C20 54.2 19.8 58 20.8 63L27 100M54.5 38.5V45C63 46.5 73 48 77.5 52C80 54.2 80.2 58 79.2 63L73 100"
          />
          {/* the arms the patient will hold out, hinted so the pose is obvious before the cue */}
          <path strokeDasharray="2 4" opacity={0.7} d="M21 55 7 74M79 55l14 19" />
          </g>
        </g>
      </svg>
      <Ticks inset={{ x: 6, y: 8 }} color={color} />
    </Layer>
  )
}
