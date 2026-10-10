import type { GripKind, Landmarks, Point } from '../types'

export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

const FINGERTIPS = [8, 12, 16, 20]
const PALM = [0, 5, 9, 13, 17]

/** Wrist → middle MCP. Normalizes every ratio so it works at any camera distance. */
export function handScale(lm: Landmarks): number {
  return Math.max(dist(lm[0], lm[9]), 1e-6)
}

export function pinchRatio(lm: Landmarks): number {
  return dist(lm[4], lm[8]) / handScale(lm)
}

export function fistRatio(lm: Landmarks): number {
  const total = FINGERTIPS.reduce((sum, i) => sum + dist(lm[i], lm[0]), 0)
  return total / FINGERTIPS.length / handScale(lm)
}

export function cursorPoint(lm: Landmarks, kind: GripKind): Point {
  if (kind === 'pinch') return { x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 }
  const x = PALM.reduce((sum, i) => sum + lm[i].x, 0) / PALM.length
  const y = PALM.reduce((sum, i) => sum + lm[i].y, 0) / PALM.length
  return { x, y }
}
