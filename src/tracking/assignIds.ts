import type { Point } from '../types'

export interface PrevHand {
  id: number
  wrist: Point
}

/** Greedy nearest-wrist matching. MediaPipe's left/right label flips too often to use as an id. */
export function assignIds(
  prev: PrevHand[],
  wrists: Point[],
  nextId: number,
  maxJump: number,
): { ids: number[]; nextId: number } {
  const ids = new Array<number>(wrists.length).fill(-1)
  const pairs: { i: number; j: number; d: number }[] = []
  wrists.forEach((w, i) =>
    prev.forEach((p, j) => {
      const d = Math.hypot(w.x - p.wrist.x, w.y - p.wrist.y)
      if (d <= maxJump) pairs.push({ i, j, d })
    }),
  )
  pairs.sort((a, b) => a.d - b.d)
  const usedPrev = new Set<number>()
  for (const { i, j } of pairs) {
    if (ids[i] !== -1 || usedPrev.has(j)) continue
    ids[i] = prev[j].id
    usedPrev.add(j)
  }
  for (let i = 0; i < ids.length; i++) if (ids[i] === -1) ids[i] = nextId++
  return { ids, nextId }
}
