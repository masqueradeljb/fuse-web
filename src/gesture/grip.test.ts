import { describe, expect, it } from 'vitest'
import { cursorPoint, fistRatio, handScale, pinchRatio } from './grip'
import { makeHand, withPinchRatio } from './fixtures'

describe('grip math', () => {
  it('hand scale is wrist to middle MCP', () => {
    expect(handScale(makeHand('open', 500, 400, 80))).toBeCloseTo(80)
  })

  it('open hand: neither pinch nor fist', () => {
    const lm = makeHand('open')
    expect(pinchRatio(lm)).toBeGreaterThan(1)
    expect(fistRatio(lm)).toBeGreaterThan(1.5)
  })

  it('pinch pose has a small pinch ratio', () => {
    expect(pinchRatio(makeHand('pinch'))).toBeLessThan(0.1)
  })

  it('fist pose has a small fist ratio and no pinch', () => {
    const lm = makeHand('fist')
    expect(fistRatio(lm)).toBeLessThan(0.8)
    expect(pinchRatio(lm)).toBeGreaterThan(0.3)
  })

  it('ratios do not depend on distance from camera', () => {
    expect(pinchRatio(withPinchRatio(0.25, 500, 400, 50))).toBeCloseTo(0.25)
    expect(pinchRatio(withPinchRatio(0.25, 500, 400, 200))).toBeCloseTo(0.25)
  })

  it('pinch cursor is the thumb–index midpoint', () => {
    const lm = makeHand('pinch')
    expect(cursorPoint(lm, 'pinch')).toEqual({ x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 })
  })

  it('fist cursor is the palm center', () => {
    const p = cursorPoint(makeHand('fist'), 'fist')
    expect(p.x).toBeCloseTo(510)
    expect(p.y).toBeCloseTo(327)
  })
})
