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

/** Shelves fill top to bottom in columns of `rows`, outermost column first. */
export function computeLayout(width: number, height: number, counts: Record<Side, number>, rows: number): Layout {
  const short = Math.min(width, height)
  const shelfRadius = Math.round(short * 0.05)
  const slotRadius = Math.round(short * 0.12)
  const inset = Math.round(shelfRadius * 1.6)
  const colGap = Math.round(shelfRadius * 2.4)
  const place = (side: Side, count: number): Point[] =>
    Array.from({ length: count }, (_, i) => {
      const offset = inset + Math.floor(i / rows) * colGap
      return { x: side === 'left' ? offset : width - offset, y: (height * ((i % rows) + 1)) / (rows + 1) }
    })
  return {
    width,
    height,
    shelfRadius,
    slotRadius,
    cardRadius: Math.round(slotRadius * 1.5),
    shelf: { left: place('left', counts.left), right: place('right', counts.right) },
    slots: [
      { x: width * 0.3, y: height / 2 },
      { x: width * 0.7, y: height / 2 },
    ],
    center: { x: width / 2, y: height / 2 },
  }
}
