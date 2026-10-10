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

export function computeLayout(width: number, height: number, perShelf: number): Layout {
  const short = Math.min(width, height)
  const shelfRadius = Math.round(short * 0.05)
  const slotRadius = Math.round(short * 0.12)
  const inset = Math.round(shelfRadius * 1.6)
  const ys = Array.from({ length: perShelf }, (_, i) => (height * (i + 1)) / (perShelf + 1))
  return {
    width,
    height,
    shelfRadius,
    slotRadius,
    cardRadius: Math.round(slotRadius * 1.5),
    shelf: {
      left: ys.map((y) => ({ x: inset, y })),
      right: ys.map((y) => ({ x: width - inset, y })),
    },
    slots: [
      { x: width * 0.3, y: height / 2 },
      { x: width * 0.7, y: height / 2 },
    ],
    center: { x: width / 2, y: height / 2 },
  }
}
