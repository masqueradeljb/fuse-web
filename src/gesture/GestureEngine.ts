import { gripConfig as defaultConfig, type GripConfig } from '../config'
import type { GripEvent, GripKind, HandCursor, InputFrame, Point, TrackedHand } from '../types'
import { cursorPoint, fistRatio, pinchRatio } from './grip'

interface HandState {
  gripping: boolean
  kind: GripKind
  startCount: number
  endCount: number
  lostCount: number
  /** cursor = anchor(kind) + offset, so switching kind never moves the cursor */
  offset: Point
  point: Point
}

/** Turns tracked hands into cursors + grip events. Pure apart from per-hand memory. */
export class GestureEngine {
  private states = new Map<number, HandState>()

  constructor(private config: GripConfig = defaultConfig) {}

  update(hands: TrackedHand[]): InputFrame {
    const c = this.config
    const cursors: HandCursor[] = []
    const events: GripEvent[] = []
    const seen = new Set<number>()

    for (const hand of hands) {
      seen.add(hand.id)
      const lm = hand.landmarks
      const pinch = pinchRatio(lm)
      const fist = fistRatio(lm)
      let s = this.states.get(hand.id)
      if (!s) {
        s = { gripping: false, kind: 'pinch', startCount: 0, endCount: 0, lostCount: 0, offset: { x: 0, y: 0 }, point: cursorPoint(lm, 'pinch') }
        this.states.set(hand.id, s)
      }
      s.lostCount = 0

      const anchor = (kind: GripKind) => cursorPoint(lm, kind)
      /** Switch the anchor kind without moving the cursor. */
      const setKind = (kind: GripKind) => {
        if (kind === s.kind) return
        const a = anchor(kind)
        s.offset = { x: s.point.x - a.x, y: s.point.y - a.y }
        s.kind = kind
      }
      const place = () => {
        const a = anchor(s.kind)
        s.point = { x: a.x + s.offset.x, y: a.y + s.offset.y }
      }

      if (!s.gripping) {
        const candidate: GripKind | null =
          pinch < c.pinchThreshold ? 'pinch' : fist < c.fistThreshold ? 'fist' : null
        s.startCount = candidate ? s.startCount + 1 : 0
        if (candidate === 'fist') {
          setKind('fist')
        } else {
          s.kind = 'pinch'
          s.offset = { x: 0, y: 0 }
        }
        place()
        if (candidate && s.startCount >= c.startFrames) {
          s.gripping = true
          s.endCount = 0
          events.push({ type: 'gripStart', handId: hand.id, point: s.point })
        }
      } else {
        const pinchHeld = pinch < c.pinchThreshold * c.releaseFactor
        const fistHeld = fist < c.fistThreshold * c.releaseFactor
        const currentHeld = s.kind === 'pinch' ? pinchHeld : fistHeld
        if (!currentHeld && (s.kind === 'pinch' ? fist < c.fistThreshold : pinch < c.pinchThreshold)) {
          setKind(s.kind === 'pinch' ? 'fist' : 'pinch')
          s.endCount = 0
        } else {
          s.endCount = pinchHeld || fistHeld ? 0 : s.endCount + 1
        }
        place()
        if (s.endCount >= c.endFrames) {
          events.push({ type: 'gripEnd', handId: hand.id, point: s.point })
          s.gripping = false
          s.startCount = 0
          s.kind = 'pinch'
          s.offset = { x: 0, y: 0 }
        }
      }
      cursors.push({ handId: hand.id, point: s.point, gripping: s.gripping, pinchRatio: pinch, fistRatio: fist })
    }

    for (const [id, s] of this.states) {
      if (seen.has(id)) continue
      s.lostCount++
      if (s.lostCount <= c.lostGraceFrames) {
        cursors.push({ handId: id, point: s.point, gripping: s.gripping })
        continue
      }
      if (s.gripping) events.push({ type: 'gripEnd', handId: id, point: s.point })
      this.states.delete(id)
    }

    return { cursors, events }
  }
}
