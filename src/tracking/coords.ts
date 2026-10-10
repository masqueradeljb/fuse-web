import type { Point } from '../types'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Where a srcW×srcH video lands when drawn "object-fit: cover" into dstW×dstH. */
export function coverRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  const s = Math.max(dstW / srcW, dstH / srcH)
  const w = srcW * s
  const h = srcH * s
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h }
}

/** MediaPipe normalized coords → screen px, matching a cover-fit video mirrored about the viewport. */
export function toScreen(nx: number, ny: number, rect: Rect, dstW: number): Point {
  return { x: dstW - (rect.x + nx * rect.w), y: rect.y + ny * rect.h }
}
