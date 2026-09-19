// Canvas drawing for CameraView's overlay. Landmark math everywhere else uses RAW coordinates; ONLY this draw layer
// mirrors (x -> 1 - x) so the overlay lines up with the CSS-mirrored <video>.
import type { Connection, VisionSnapshot } from '../lib/vision/useMediaPipe'
import type { Landmark } from '../lib/vision/landmarks'

/** Raw normalized landmark -> canvas pixels, optionally mirrored horizontally. */
export const toCanvasPoint = (p: { x: number; y: number }, w: number, h: number, mirror = true): { x: number; y: number } => ({
  x: (mirror ? 1 - p.x : p.x) * w,
  y: p.y * h,
})

export type AssumedSide = 'L' | 'R'
export interface DebugPoint {
  idx: number
  side: AssumedSide // ASSUMED anatomical side of the PATIENT (see the mapping comment in face.ts / arms.ts)
  name: string
  long?: boolean // print the full "patient LEFT/RIGHT (assumed)" text next to this one
}

// Face Mesh indices used by the face/eyes tests. Assumed: 33/133/159/145/61/468 = patient RIGHT (small x in a raw frame).
export const FACE_DEBUG_POINTS: readonly DebugPoint[] = [
  { idx: 61, side: 'R', name: 'mouth', long: true },
  { idx: 291, side: 'L', name: 'mouth', long: true },
  { idx: 33, side: 'R', name: 'eye outer' },
  { idx: 263, side: 'L', name: 'eye outer' },
  { idx: 133, side: 'R', name: 'eye inner' },
  { idx: 362, side: 'L', name: 'eye inner' },
  { idx: 159, side: 'R', name: 'lid top' },
  { idx: 145, side: 'R', name: 'lid bottom' },
  { idx: 386, side: 'L', name: 'lid top' },
  { idx: 374, side: 'L', name: 'lid bottom' },
  { idx: 468, side: 'R', name: 'iris' },
  { idx: 473, side: 'L', name: 'iris' },
]
// BlazePose 11-16. Assumed: odd = patient LEFT, even = patient RIGHT.
export const POSE_DEBUG_POINTS: readonly DebugPoint[] = [
  { idx: 11, side: 'L', name: 'shoulder', long: true },
  { idx: 12, side: 'R', name: 'shoulder', long: true },
  { idx: 13, side: 'L', name: 'elbow' },
  { idx: 14, side: 'R', name: 'elbow' },
  { idx: 15, side: 'L', name: 'wrist', long: true },
  { idx: 16, side: 'R', name: 'wrist', long: true },
]

export const SIDE_COLOR: Record<AssumedSide, string> = { L: '#22d3ee', R: '#fb923c' } // cyan / orange

export interface DrawOptions {
  debug: boolean
  connections: { face: Connection[]; pose: Connection[] }
  mirror?: boolean
}

const dot = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) => {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  lms: Landmark[],
  conns: Connection[],
  w: number,
  h: number,
  mirror: boolean,
  minVis: number,
) {
  ctx.beginPath()
  for (const { start, end } of conns) {
    const a = lms[start]
    const b = lms[end]
    if (!a || !b || (a.visibility ?? 1) < minVis || (b.visibility ?? 1) < minVis) continue
    const pa = toCanvasPoint(a, w, h, mirror)
    const pb = toCanvasPoint(b, w, h, mirror)
    ctx.moveTo(pa.x, pa.y)
    ctx.lineTo(pb.x, pb.y)
  }
  ctx.stroke()
}

function drawDebugPoints(
  ctx: CanvasRenderingContext2D,
  lms: Landmark[],
  pts: readonly DebugPoint[],
  w: number,
  h: number,
  mirror: boolean,
  minVis: number,
) {
  ctx.font = 'bold 12px ui-monospace, monospace'
  ctx.textBaseline = 'middle'
  for (const p of pts) {
    const lm = lms[p.idx]
    if (!lm || (lm.visibility ?? 1) < minVis) continue
    const c = toCanvasPoint(lm, w, h, mirror)
    const color = SIDE_COLOR[p.side]
    dot(ctx, c.x, c.y, 4, color)
    const text = p.long ? `${p.idx} ${p.name} - patient ${p.side === 'L' ? 'LEFT' : 'RIGHT'} (assumed)` : `${p.idx} ${p.side}`
    // Put the label on the outer side of the point so it doesn't cover the face.
    const right = c.x >= w / 2
    ctx.textAlign = right ? 'left' : 'right'
    const tx = c.x + (right ? 8 : -8)
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'
    ctx.strokeText(text, tx, c.y)
    ctx.fillStyle = color
    ctx.fillText(text, tx, c.y)
  }
}

/** Draw the face mesh contours / pose skeleton (+ debug labels) for the latest frame onto an already-cleared canvas. */
export function drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, snap: VisionSnapshot, o: DrawOptions): void {
  const mirror = o.mirror ?? true
  ctx.lineJoin = 'round'
  if (snap.face) {
    const lms = snap.face.landmarks
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    drawLines(ctx, lms, o.connections.face, w, h, mirror, 0)
    if (o.debug) drawDebugPoints(ctx, lms, FACE_DEBUG_POINTS, w, h, mirror, 0)
    else for (const i of [61, 291, 33, 263]) if (lms[i]) dot(ctx, ...pt(lms[i], w, h, mirror), 3, '#7dd3fc')
  }
  if (snap.pose) {
    const lms = snap.pose.landmarks
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(52,211,153,0.9)'
    // upper body only (0..24): legs are out of frame or noise in this test
    drawLines(ctx, lms, o.connections.pose.filter((c) => c.start <= 24 && c.end <= 24), w, h, mirror, 0.5)
    if (o.debug) drawDebugPoints(ctx, lms, POSE_DEBUG_POINTS, w, h, mirror, 0)
    else for (const i of [11, 12, 13, 14, 15, 16]) if ((lms[i]?.visibility ?? 0) >= 0.5) dot(ctx, ...pt(lms[i], w, h, mirror), 4, '#34d399')
  }
  if (o.debug) {
    ctx.font = 'bold 12px ui-monospace, monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const lines: [string, string][] = [
      ['#22d3ee', 'cyan L = patient LEFT (assumed)'],
      ['#fb923c', 'orange R = patient RIGHT (assumed)'],
      ['#e2e8f0', 'display is MIRRORED; landmarks are raw'],
    ]
    lines.forEach(([c, t], i) => {
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'
      ctx.strokeText(t, 8, 8 + i * 16)
      ctx.fillStyle = c
      ctx.fillText(t, 8, 8 + i * 16)
    })
  }
}

const pt = (p: Landmark, w: number, h: number, mirror: boolean): [number, number] => {
  const c = toCanvasPoint(p, w, h, mirror)
  return [c.x, c.y]
}
