// Subject selection: PURE, no DOM. With two people in view (a judge walks behind the patient) the landmarkers can return
// several faces/poses and, with a single-instance model, silently flip between them from frame to frame. The analyzers
// must measure ONE person, never mix landmarks across people, and ignore bystanders. `SubjectTracker` picks the largest /
// most central candidate, then STICKS to that person by proximity to where they were last frame.
//
// Everything here is UNCALIBRATED (no real two-person recordings yet). Coordinates are normalized image coordinates
// (raw, unmirrored); `size` is a characteristic length (face width, shoulder width) as a fraction of frame width.
import type { Landmark } from './landmarks'
import { POSE } from './landmarks'

export const SUBJECT_CONFIG = {
  memoryMs: 3000, // ms: keep waiting for a vanished subject this long (matches CAPTURE_TIMING.framingLossGraceMs) before re-picking someone
  matchRadius: 0.6, // face-widths (of the larger of the two boxes) a subject may move between two frames and still be the same person
  matchRadiusPerS: 0.15, // extra face-widths of allowance per second since the subject was last seen
  takeoverRatio: 2.2, // a candidate this many times bigger than the tracked subject may take over ...
  takeoverDwellMs: 1200, // ... after dominating for this long (patient arrives after a passer-by was locked; not for a quick walk-by)
  bystanderMinRatio: 0.35, // another person at least this fraction of the subject's size counts as a bystander (smaller = far background)
  ambiguousRatio: 0.75, // ... and at least this similar in size means we cannot tell who is being tested: block the run
  duplicateDist: 0.3, // a second box whose centre is within this many sizes of the subject's, and about as big, is a duplicate detection
  centreWeight: 1.2, // score = size * (centreWeight - distance from image centre): larger AND more central wins the first pick
} as const

export interface SubjectBox {
  cx: number
  cy: number
  size: number
}

/** Bounding box of a face mesh: centre and width. Loops only (runs at frame rate). */
export function faceBox(lm: readonly { x: number; y: number }[]): SubjectBox | null {
  if (!lm || lm.length === 0) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < lm.length; i++) {
    const p = lm[i]
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, size: maxX - minX }
}

/** Body box from a pose: centre = midpoint of the shoulders, size = shoulder span (arms out do not inflate it). */
export function poseBox(lm: readonly Landmark[]): SubjectBox | null {
  const a: Landmark | undefined = lm?.[POSE.shoulderL]
  const b: Landmark | undefined = lm?.[POSE.shoulderR]
  if (!a || !b || ![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, size: Math.abs(a.x - b.x) }
}

export interface Candidate {
  index: number // index into the landmarker's result arrays (landmarks, blendshapes, matrices)
  box: SubjectBox
}

export interface Selection {
  /** Index of the tracked subject in this result, or null when the subject is not (yet) visible. */
  index: number | null
  /** Other people big enough to matter (not a far-away background person, not a duplicate detection). */
  bystanders: number
  /** A bystander about as big as the subject: we cannot tell whom to measure, so the run should not start. */
  ambiguous: boolean
  /** Bumps whenever the tracked person changes (first pick after loss, takeover). Frames of different epochs never mix. */
  epoch: number
}

const dist = (a: SubjectBox, b: SubjectBox): number => Math.hypot(a.cx - b.cx, a.cy - b.cy)

export class SubjectTracker {
  private last: (SubjectBox & { t: number }) | undefined
  private epoch = 0
  private takeoverSince: number | undefined
  private readonly cfg = SUBJECT_CONFIG

  reset(): void {
    this.last = undefined
    this.takeoverSince = undefined
    this.epoch++
  }

  get currentEpoch(): number {
    return this.epoch
  }

  select(cands: readonly Candidate[], t: number): Selection {
    const C = this.cfg
    const none = (): Selection => ({ index: null, bystanders: 0, ambiguous: false, epoch: this.epoch })
    if (cands.length === 0) return none()

    const seenRecently = this.last !== undefined && t - this.last.t <= C.memoryMs
    let chosen = -1
    if (this.last && seenRecently) {
      // Stick to the tracked person: the nearest candidate within a plausible movement radius.
      const dtS = Math.max(0, t - this.last.t) / 1000
      let best = Infinity
      cands.forEach((c, i) => {
        const d = dist(c.box, this.last!)
        const radius = Math.max(c.box.size, this.last!.size) * (C.matchRadius + C.matchRadiusPerS * dtS)
        if (d <= radius && d < best) {
          best = d
          chosen = i
        }
      })
      if (chosen < 0) {
        // The subject is gone but someone else is in view: do NOT hand the run to them. Wait out the memory window.
        return { ...none(), bystanders: cands.length }
      }
      // A much bigger, dominant newcomer may take over after a dwell (e.g. the patient arrives after a passer-by was locked).
      const bigger = cands.findIndex((c, i) => i !== chosen && c.box.size >= cands[chosen].box.size * C.takeoverRatio)
      if (bigger >= 0) {
        this.takeoverSince ??= t
        if (t - this.takeoverSince >= C.takeoverDwellMs) {
          chosen = bigger
          this.epoch++
          this.takeoverSince = undefined
        }
      } else this.takeoverSince = undefined
    } else {
      // First pick (or the subject was lost too long): largest and most central.
      let best = -Infinity
      cands.forEach((c, i) => {
        const score = c.box.size * (C.centreWeight - Math.hypot(c.box.cx - 0.5, c.box.cy - 0.5))
        if (score > best) {
          best = score
          chosen = i
        }
      })
      if (this.last) this.epoch++ // a different person than the one we lost
      this.takeoverSince = undefined
    }

    const s = cands[chosen].box
    this.last = { ...s, t }

    let bystanders = 0
    let ambiguous = false
    cands.forEach((c, i) => {
      if (i === chosen) return
      const ratio = c.box.size / Math.max(s.size, 1e-6)
      const duplicate = dist(c.box, s) <= C.duplicateDist * Math.max(s.size, c.box.size) && ratio > 0.6 && ratio < 1.6
      if (duplicate || ratio < C.bystanderMinRatio) return
      bystanders++
      if (ratio >= C.ambiguousRatio) ambiguous = true
    })
    return { index: cands[chosen].index, bystanders, ambiguous, epoch: this.epoch }
  }
}

/** What the runtime tells the runner about the people in view (the analyzers only ever see the selected subject). */
export interface SubjectInfo {
  bystanders: number
  ambiguous: boolean
  /** Changes whenever the tracked person changes; a capture that started under one epoch must not continue under another. */
  epoch: number
}

export const ONE_PERSON_HINT = 'One person at a time, please. Ask others to step out of view.'
export const SWITCHED_PERSON_HINT = 'Someone else came into view. One person at a time, please.'

/** Run the tracker over a landmarker result's face list (or pose list) using the given box function. */
export function selectSubject(
  tracker: SubjectTracker,
  lists: readonly (readonly Landmark[])[],
  box: (lm: readonly Landmark[]) => SubjectBox | null,
  t: number,
): Selection {
  const cands: Candidate[] = []
  for (let i = 0; i < lists.length; i++) {
    const b = box(lists[i])
    if (b && b.size > 0) cands.push({ index: i, box: b })
  }
  return tracker.select(cands, t)
}
