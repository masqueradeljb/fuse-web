import { describe, expect, it } from 'vitest'
import { coverRect, toScreen } from './coords'

describe('coords', () => {
  it('cover-fits a 16:9 video into a square viewport', () => {
    const r = coverRect(1280, 720, 1000, 1000)
    expect(r.w).toBeCloseTo(1777.78, 1)
    expect(r.h).toBeCloseTo(1000)
    expect(r.x).toBeCloseTo(-388.89, 1)
    expect(r.y).toBeCloseTo(0)
  })

  it('maps the video center to the viewport center', () => {
    const r = coverRect(1280, 720, 1000, 1000)
    const p = toScreen(0.5, 0.5, r, 1000)
    expect(p.x).toBeCloseTo(500)
    expect(p.y).toBeCloseTo(500)
  })

  it('mirrors: the left edge of the video lands on the right', () => {
    const r = coverRect(1280, 720, 1000, 1000)
    expect(toScreen(0, 0, r, 1000).x).toBeCloseTo(1388.89, 1)
  })
})
