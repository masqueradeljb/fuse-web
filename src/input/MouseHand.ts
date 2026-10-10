import type { GripEvent, HandCursor, InputFrame } from '../types'

/** HandTracker ids start at 1, so 0 is free for the mouse. */
export const MOUSE_HAND_ID = 0

/** The mouse as one hand: press = grip. Emits the same InputFrame shape as GestureEngine. */
export class MouseHand {
  private cursor: HandCursor | null = null
  private pending: GripEvent[] = []

  constructor(target: HTMLElement) {
    target.addEventListener('pointermove', (e) => this.move(e.clientX, e.clientY))
    target.addEventListener('pointerdown', (e) => {
      const c = this.move(e.clientX, e.clientY)
      c.gripping = true
      this.pending.push({ type: 'gripStart', handId: MOUSE_HAND_ID, point: { ...c.point } })
    })
    target.addEventListener('pointerup', (e) => this.release(e.clientX, e.clientY))
    target.addEventListener('pointerleave', (e) => {
      this.release(e.clientX, e.clientY)
      this.cursor = null
    })
  }

  poll(): InputFrame {
    const events = this.pending
    this.pending = []
    return { cursors: this.cursor ? [{ ...this.cursor, point: { ...this.cursor.point } }] : [], events }
  }

  private move(x: number, y: number): HandCursor {
    if (!this.cursor) this.cursor = { handId: MOUSE_HAND_ID, point: { x, y }, gripping: false }
    this.cursor.point = { x, y }
    return this.cursor
  }

  private release(x: number, y: number): void {
    if (!this.cursor?.gripping) return
    this.move(x, y).gripping = false
    this.pending.push({ type: 'gripEnd', handId: MOUSE_HAND_ID, point: { x, y } })
  }
}
