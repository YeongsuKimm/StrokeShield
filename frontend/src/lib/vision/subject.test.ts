import { describe, expect, it } from 'vitest'
import { faceBox, poseBox, SUBJECT_CONFIG, SubjectTracker, type Candidate } from './subject'

const cand = (index: number, cx: number, cy: number, size: number): Candidate => ({ index, box: { cx, cy, size } })

describe('SubjectTracker: one consistent subject', () => {
  it('first pick is the larger, more central person', () => {
    const tr = new SubjectTracker()
    const sel = tr.select([cand(0, 0.8, 0.4, 0.12), cand(1, 0.5, 0.45, 0.3)], 0)
    expect(sel.index).toBe(1)
    expect(sel.bystanders).toBe(1) // 0.12/0.3 = 0.4 >= bystanderMinRatio
    expect(sel.ambiguous).toBe(false)
  })

  it('sticks to the first person even when the result order flips and a bystander gets closer', () => {
    const tr = new SubjectTracker()
    tr.select([cand(0, 0.5, 0.45, 0.3), cand(1, 0.85, 0.4, 0.1)], 0)
    // The model now lists the bystander first and it is walking up (bigger, but not 2.2x the subject).
    for (let i = 1; i < 60; i++) {
      const t = i * 50
      const sel = tr.select([cand(0, 0.78 - i * 0.001, 0.4, 0.2 + i * 0.001), cand(1, 0.5 + i * 0.0005, 0.45, 0.3)], t)
      expect(sel.index).toBe(1)
      expect(sel.epoch).toBe(0)
    }
  })

  it('never hands the run to a bystander when the subject disappears (returns null, then re-picks with a new epoch)', () => {
    const tr = new SubjectTracker()
    tr.select([cand(0, 0.5, 0.45, 0.3)], 0)
    const gone = tr.select([cand(0, 0.15, 0.4, 0.28)], 500) // someone else, far from where the patient was
    expect(gone.index).toBeNull()
    expect(gone.bystanders).toBe(1)
    expect(tr.select([cand(0, 0.15, 0.4, 0.28)], SUBJECT_CONFIG.memoryMs - 100).index).toBeNull()
    const later = tr.select([cand(0, 0.15, 0.4, 0.28)], SUBJECT_CONFIG.memoryMs + 600)
    expect(later.index).toBe(0)
    expect(later.epoch).toBe(1) // frames from before and after must never be mixed
  })

  it('re-acquires the same person after a short dropout (same place) without changing the epoch', () => {
    const tr = new SubjectTracker()
    tr.select([cand(0, 0.5, 0.45, 0.3)], 0)
    expect(tr.select([], 200).index).toBeNull()
    const back = tr.select([cand(0, 0.52, 0.45, 0.3)], 1500)
    expect(back.index).toBe(0)
    expect(back.epoch).toBe(0)
  })

  it('a similar-size second person is ambiguous; a small far-away person is ignored', () => {
    const tr = new SubjectTracker()
    const two = tr.select([cand(0, 0.35, 0.45, 0.28), cand(1, 0.7, 0.45, 0.26)], 0)
    expect(two.ambiguous).toBe(true)
    const tr2 = new SubjectTracker()
    const far = tr2.select([cand(0, 0.5, 0.45, 0.3), cand(1, 0.85, 0.4, 0.05)], 0)
    expect(far.bystanders).toBe(0)
    expect(far.ambiguous).toBe(false)
  })

  it('a duplicate detection of the same face is not a bystander', () => {
    const tr = new SubjectTracker()
    const sel = tr.select([cand(0, 0.5, 0.45, 0.3), cand(1, 0.505, 0.452, 0.29)], 0)
    expect(sel.bystanders).toBe(0)
  })

  it('a much bigger dominant newcomer takes over only after the dwell, with a new epoch', () => {
    const tr = new SubjectTracker()
    tr.select([cand(0, 0.3, 0.4, 0.1)], 0) // passer-by locked first
    let sel = tr.select([cand(0, 0.3, 0.4, 0.1), cand(1, 0.6, 0.45, 0.3)], 100)
    expect(sel.index).toBe(0)
    sel = tr.select([cand(0, 0.3, 0.4, 0.1), cand(1, 0.6, 0.45, 0.3)], 100 + SUBJECT_CONFIG.takeoverDwellMs + 50)
    expect(sel.index).toBe(1)
    expect(sel.epoch).toBe(1)
  })

  it('a quick walk-by (shorter than the dwell) does not steal the subject', () => {
    const tr = new SubjectTracker()
    tr.select([cand(0, 0.5, 0.45, 0.2)], 0)
    tr.select([cand(0, 0.5, 0.45, 0.2), cand(1, 0.7, 0.5, 0.5)], 100)
    const after = tr.select([cand(0, 0.5, 0.45, 0.2)], 600)
    expect(after.index).toBe(0)
    expect(after.epoch).toBe(0)
  })
})

describe('box helpers', () => {
  it('faceBox handles empty and non-finite input', () => {
    expect(faceBox([])).toBeNull()
    const b = faceBox([
      { x: 0.4, y: 0.3 },
      { x: 0.6, y: 0.5 },
      { x: NaN, y: 0.1 },
    ])
    expect(b?.cx).toBeCloseTo(0.5, 6)
    expect(b?.size).toBeCloseTo(0.2, 6)
  })
  it('poseBox is the shoulder span, unaffected by raised arms', () => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }))
    lm[11] = { x: 0.55, y: 0.35, z: 0, visibility: 1 }
    lm[12] = { x: 0.45, y: 0.35, z: 0, visibility: 1 }
    lm[15] = { x: 0.95, y: 0.35, z: 0, visibility: 1 }
    expect(poseBox(lm)?.size).toBeCloseTo(0.1, 6)
    expect(poseBox([])).toBeNull()
  })
})
