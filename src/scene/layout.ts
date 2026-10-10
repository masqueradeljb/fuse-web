import type { Point } from '../types'

export type Side = 'left' | 'right'

export interface Layout {
  width: number
  height: number
  shelfRadius: number
  slotRadius: number
  cardRadius: number
  shelf: Record<Side, Point[]>
  slots: [Point, Point]
  center: Point
}

/** Mirrors sceneConfig.hoverFactor: a logo can be grabbed within radius x this. */
const GRAB = 1.3
const SLOT_GAP = 8
/** two-hand fuse fires at 2.4 slot radii; rest distance must stay clear of it */
const MIN_SLOT_SPAN = 2.6

/** Shelves fill top to bottom in columns of `rows`, outermost column first. */
export function computeLayout(width: number, height: number, counts: Record<Side, number>, rows: number): Layout {
  const short = Math.min(width, height)
  const shelfRadius = Math.round(short * 0.05)
  let slotRadius = Math.round(short * 0.12)
  const inset = Math.round(shelfRadius * 1.6)
  const colGap = Math.round(shelfRadius * 2.4)
  const place = (side: Side, count: number): Point[] =>
    Array.from({ length: count }, (_, i) => {
      const offset = inset + Math.floor(i / rows) * colGap
      return { x: side === 'left' ? offset : width - offset, y: (height * ((i % rows) + 1)) / (rows + 1) }
    })
  const shelf = { left: place('left', counts.left), right: place('right', counts.right) }

  /** slots stay at 30%/70% but move inward so no grab disk overlaps a shelf logo's */
  const slotXs = (sr: number): [number, number] => {
    const clear = GRAB * shelfRadius + GRAB * sr + SLOT_GAP
    const x0 = shelf.left.length ? Math.max(width * 0.3, Math.max(...shelf.left.map((p) => p.x)) + clear) : width * 0.3
    const x1 = shelf.right.length ? Math.min(width * 0.7, Math.min(...shelf.right.map((p) => p.x)) - clear) : width * 0.7
    return [x0, x1]
  }
  let [x0, x1] = slotXs(slotRadius)
  const minRadius = Math.round(shelfRadius * 1.2)
  while (x1 - x0 < MIN_SLOT_SPAN * slotRadius && slotRadius > minRadius) {
    slotRadius--
    ;[x0, x1] = slotXs(slotRadius)
  }
  return {
    width,
    height,
    shelfRadius,
    slotRadius,
    cardRadius: Math.round(slotRadius * 1.5),
    shelf,
    slots: [
      { x: x0, y: height / 2 },
      { x: x1, y: height / 2 },
    ],
    center: { x: width / 2, y: height / 2 },
  }
}
