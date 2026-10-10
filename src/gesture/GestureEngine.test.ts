import { describe, expect, it } from 'vitest'
import { gripConfig } from '../config'
import type { Landmarks } from '../types'
import { GestureEngine } from './GestureEngine'
import { makeHand, withPinchRatio } from './fixtures'

const engine = () => new GestureEngine({ ...gripConfig, lostGraceFrames: 3 })
const hand = (landmarks: Landmarks, id = 1) => ({ id, landmarks })

describe('GestureEngine', () => {
  it('open hand reports a non-gripping cursor and no events', () => {
    const out = engine().update([hand(makeHand('open'))])
    expect(out.events).toEqual([])
    expect(out.cursors).toHaveLength(1)
    expect(out.cursors[0].gripping).toBe(false)
  })

  it('pinch must hold for startFrames before gripStart', () => {
    const e = engine()
    expect(e.update([hand(makeHand('pinch'))]).events).toEqual([])
    const second = e.update([hand(makeHand('pinch'))])
    expect(second.events).toHaveLength(1)
    expect(second.events[0]).toMatchObject({ type: 'gripStart', handId: 1 })
    expect(second.cursors[0].gripping).toBe(true)
  })

  it('a one-frame pinch blip does not grip', () => {
    const e = engine()
    e.update([hand(makeHand('pinch'))])
    expect(e.update([hand(makeHand('open'))]).events).toEqual([])
    expect(e.update([hand(makeHand('open'))]).events).toEqual([])
  })

  it('release needs ratio above threshold × releaseFactor for endFrames', () => {
    const e = engine()
    e.update([hand(withPinchRatio(0.1))])
    e.update([hand(withPinchRatio(0.1))])
    for (let i = 0; i < 5; i++) {
      // 0.35 is above 0.30 but below 0.39: still gripping
      expect(e.update([hand(withPinchRatio(0.35))]).events).toEqual([])
    }
    expect(e.update([hand(withPinchRatio(0.5))]).events).toEqual([])
    expect(e.update([hand(withPinchRatio(0.5))]).events).toEqual([])
    const third = e.update([hand(withPinchRatio(0.5))])
    expect(third.events).toEqual([expect.objectContaining({ type: 'gripEnd', handId: 1 })])
  })

  it('fist grips, starting at the continuous idle cursor point', () => {
    const e = engine()
    const lm = makeHand('open')
    e.update([hand(lm)])
    e.update([hand(makeHand('fist'))])
    const out = e.update([hand(makeHand('fist'))])
    expect(out.events[0].type).toBe('gripStart')
    expect(out.events[0].point.x).toBeCloseTo((lm[4].x + lm[8].x) / 2)
    expect(out.events[0].point.y).toBeCloseTo((lm[4].y + lm[8].y) / 2)
  })

  it('tracks two hands independently', () => {
    const e = engine()
    e.update([hand(makeHand('pinch', 300), 1), hand(makeHand('open', 700), 2)])
    const out = e.update([hand(makeHand('pinch', 300), 1), hand(makeHand('open', 700), 2)])
    expect(out.events).toEqual([expect.objectContaining({ type: 'gripStart', handId: 1 })])
    expect(out.cursors.map((c) => [c.handId, c.gripping])).toEqual([[1, true], [2, false]])
  })

  it('keeps a lost hand gripping during the grace period, then ends the grip', () => {
    const e = engine()
    e.update([hand(makeHand('pinch'))])
    e.update([hand(makeHand('pinch'))])
    for (let i = 0; i < 3; i++) {
      const out = e.update([])
      expect(out.events).toEqual([])
      expect(out.cursors[0]).toMatchObject({ handId: 1, gripping: true })
    }
    const out = e.update([])
    expect(out.events).toEqual([expect.objectContaining({ type: 'gripEnd', handId: 1 })])
    expect(out.cursors).toEqual([])
  })
  describe('cursor continuity and handoff', () => {
    const near = (p: { x: number; y: number }, x: number, y: number, tol = 3) => {
      expect(Math.abs(p.x - x)).toBeLessThan(tol)
      expect(Math.abs(p.y - y)).toBeLessThan(tol)
    }

    it('open hover then fist: gripStart point is the last hover point, not the palm center', () => {
      const e = engine()
      e.update([hand(makeHand('open'))])
      const hover = e.update([hand(makeHand('open'))]).cursors[0].point
      e.update([hand(makeHand('fist'))])
      const out = e.update([hand(makeHand('fist'))])
      expect(out.events[0].type).toBe('gripStart')
      near(out.events[0].point, hover.x, hover.y)
    })

    it('after a fist gripStart, the cursor moves with the palm', () => {
      const e = engine()
      e.update([hand(makeHand('open'))])
      e.update([hand(makeHand('fist'))])
      const start = e.update([hand(makeHand('fist'))]).cursors[0].point
      const moved = e.update([hand(makeHand('fist', 550, 420))]).cursors[0].point
      near(moved, start.x + 50, start.y + 20, 0.01)
    })

    it('pinch grip then fist: no gripEnd, still gripping, no cursor jump', () => {
      const e = engine()
      e.update([hand(makeHand('pinch'))])
      const before = e.update([hand(makeHand('pinch'))]).cursors[0].point
      const first = e.update([hand(makeHand('fist'))])
      expect(first.events).toEqual([])
      near(first.cursors[0].point, before.x, before.y)
      for (let i = 0; i < 6; i++) {
        const out = e.update([hand(makeHand('fist'))])
        expect(out.events).toEqual([])
        expect(out.cursors[0].gripping).toBe(true)
      }
    })

    it('fist grip ends when the hand opens for endFrames', () => {
      const e = engine()
      e.update([hand(makeHand('fist'))])
      e.update([hand(makeHand('fist'))])
      expect(e.update([hand(makeHand('open'))]).events).toEqual([])
      expect(e.update([hand(makeHand('open'))]).events).toEqual([])
      const out = e.update([hand(makeHand('open'))])
      expect(out.events).toEqual([expect.objectContaining({ type: 'gripEnd', handId: 1 })])
    })

    it('a hand that reappears within the grace period keeps its grip', () => {
      const e = engine()
      e.update([hand(makeHand('pinch'))])
      e.update([hand(makeHand('pinch'))])
      e.update([])
      e.update([])
      const out = e.update([hand(makeHand('pinch'))])
      expect(out.events).toEqual([])
      expect(out.cursors[0].gripping).toBe(true)
    })

    it('after gripEnd the idle cursor is the pinch midpoint again', () => {
      const e = engine()
      e.update([hand(makeHand('fist'))])
      e.update([hand(makeHand('fist'))])
      for (let i = 0; i < 3; i++) e.update([hand(makeHand('open'))])
      const lm = makeHand('open')
      const out = e.update([hand(lm)])
      expect(out.cursors[0].gripping).toBe(false)
      near(out.cursors[0].point, (lm[4].x + lm[8].x) / 2, (lm[4].y + lm[8].y) / 2, 0.01)
    })
  })
})
