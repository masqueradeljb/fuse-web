import type { Landmarks, Point } from '../types'

// Offsets in units of hand scale (wrist #0 → middle MCP #9 = 1), y up is negative.
const BASE: Record<number, [number, number]> = {
  0: [0, 0],
  5: [-0.35, -0.9],
  9: [0, -1],
  13: [0.3, -0.95],
  17: [0.55, -0.8],
}

const POSES: Record<'open' | 'pinch' | 'fist', Record<number, [number, number]>> = {
  open: { 4: [-0.9, -0.8], 8: [-0.4, -1.9], 12: [0, -2], 16: [0.3, -1.9], 20: [0.6, -1.6] },
  pinch: { 4: [-0.35, -1.3], 8: [-0.4, -1.35], 12: [0, -2], 16: [0.3, -1.9], 20: [0.6, -1.6] },
  fist: { 4: [0.1, -0.75], 8: [-0.3, -0.6], 12: [0, -0.6], 16: [0.25, -0.6], 20: [0.45, -0.55] },
}

/** A synthetic hand centered on its wrist at (cx, cy), hand scale s px. */
export function makeHand(pose: 'open' | 'pinch' | 'fist', cx = 500, cy = 400, s = 100): Landmarks {
  const lm: Point[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy - s }))
  for (const [i, [dx, dy]] of Object.entries({ ...BASE, ...POSES[pose] })) {
    lm[Number(i)] = { x: cx + dx * s, y: cy + dy * s }
  }
  return lm
}

/** An open hand whose thumb tip sits exactly `ratio` hand-scales right of the index tip. */
export function withPinchRatio(ratio: number, cx = 500, cy = 400, s = 100): Landmarks {
  const lm = makeHand('open', cx, cy, s)
  lm[4] = { x: lm[8].x + ratio * s, y: lm[8].y }
  return lm
}
