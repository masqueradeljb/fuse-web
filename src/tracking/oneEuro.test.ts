import { describe, expect, it } from 'vitest'
import { OneEuroFilter } from './oneEuro'

const FRAME = 1000 / 60

describe('OneEuroFilter', () => {
  it('passes the first value through', () => {
    expect(new OneEuroFilter().filter(42, 0)).toBe(42)
  })

  it('keeps a constant signal constant', () => {
    const f = new OneEuroFilter()
    for (let i = 0; i < 30; i++) expect(f.filter(10, i * FRAME)).toBeCloseTo(10)
  })

  it('smooths a step, then converges', () => {
    const f = new OneEuroFilter()
    f.filter(0, 0)
    const first = f.filter(100, FRAME)
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(100)
    let v = first
    for (let i = 2; i <= 60; i++) v = f.filter(100, i * FRAME)
    expect(v).toBeGreaterThan(99)
  })
})
