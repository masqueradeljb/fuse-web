import { gripConfig as defaultConfig, type GripConfig } from '../config'
import type { GripEvent, GripKind, HandCursor, InputFrame, Point, TrackedHand } from '../types'
import { cursorPoint, fistRatio, pinchRatio } from './grip'

interface HandState {
  gripping: boolean
  kind: GripKind
  startCount: number
  endCount: number
  lostCount: number
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
        s = { gripping: false, kind: 'pinch', startCount: 0, endCount: 0, lostCount: 0, point: cursorPoint(lm, 'pinch') }
        this.states.set(hand.id, s)
      }
      s.lostCount = 0

      if (!s.gripping) {
        const candidate: GripKind | null =
          pinch < c.pinchThreshold ? 'pinch' : fist < c.fistThreshold ? 'fist' : null
        s.startCount = candidate ? s.startCount + 1 : 0
        if (candidate) s.kind = candidate
        s.point = cursorPoint(lm, candidate ?? 'pinch')
        if (candidate && s.startCount >= c.startFrames) {
          s.gripping = true
          s.endCount = 0
          events.push({ type: 'gripStart', handId: hand.id, point: s.point })
        }
      } else {
        const released =
          s.kind === 'pinch' ? pinch > c.pinchThreshold * c.releaseFactor : fist > c.fistThreshold * c.releaseFactor
        s.endCount = released ? s.endCount + 1 : 0
        s.point = cursorPoint(lm, s.kind)
        if (s.endCount >= c.endFrames) {
          s.gripping = false
          s.startCount = 0
          events.push({ type: 'gripEnd', handId: hand.id, point: s.point })
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
