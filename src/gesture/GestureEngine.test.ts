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

  it('fist grips with the palm center as cursor', () => {
    const e = engine()
    e.update([hand(makeHand('fist'))])
    const out = e.update([hand(makeHand('fist'))])
    expect(out.events[0].type).toBe('gripStart')
    expect(out.events[0].point.x).toBeCloseTo(510)
    expect(out.events[0].point.y).toBeCloseTo(327)
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
})
