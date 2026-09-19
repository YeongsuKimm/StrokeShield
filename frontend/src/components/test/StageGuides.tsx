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

type GuideTone = 'waiting' | 'ok'

const STROKE: Record<GuideTone, string> = { waiting: 'rgba(255,255,255,0.8)', ok: 'var(--color-ok)' }

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
  return (
    <div className="pointer-events-none absolute inset-0" role="img" aria-label={label}>
      {children}
    </div>
  )
}

/** Dashed oval for the close-up checks (speech, eyes, face): "put your head here". */
export function HeadGuide({ tone = 'waiting' }: { tone?: GuideTone }) {
  const color = STROKE[tone]
  return (
    <Layer label="Outline showing where to place your head">
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
  const color = STROKE[tone]
  return (
    <Layer label="Outline showing where to stand for the arm check">
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
          {/* head, neck, shoulders and torso as one silhouette, filling most of the frame height */}
          <path
            strokeDasharray="4 5"
            d="M41 22c0-5 4-9 9-9s9 4 9 9c0 5.6-2.3 8.6-4.3 10.3 1.7 1 2.7 2.3 4 3.2 4.3 2.6 11.2 4 15.5 5.6 5 2 7.6 5.3 8.2 10.6L85 96M15 96l2.6-44.3c.6-5.3 3.2-8.6 8.2-10.6 4.3-1.6 11.2-3 15.5-5.6"
          />
          {/* the arms the patient will raise, hinted so the pose is obvious before the cue */}
          <path strokeDasharray="2 4" opacity={0.7} d="M21 54 8 76M79 54l13 22" />
        </g>
      </svg>
      <Ticks inset={{ x: 6, y: 8 }} color={color} />
    </Layer>
  )
}
