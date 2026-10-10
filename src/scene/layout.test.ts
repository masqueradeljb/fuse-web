import { describe, expect, it } from 'vitest'
import { computeLayout } from './layout'

describe('computeLayout', () => {
  const L = computeLayout(1000, 600, { left: 6, right: 6 }, 6)

  it('sizes logos from the short side', () => {
    expect(L.shelfRadius).toBe(30)
    expect(L.slotRadius).toBe(72)
    expect(L.cardRadius).toBe(108)
  })

  it('places two center slots at 30% and 70% width', () => {
    expect(L.slots).toEqual([{ x: 300, y: 300 }, { x: 700, y: 300 }])
    expect(L.center).toEqual({ x: 500, y: 300 })
  })

  it('spreads shelves evenly down each edge', () => {
    expect(L.shelf.left).toHaveLength(6)
    expect(L.shelf.left[0].x).toBeCloseTo(48)
    expect(L.shelf.left[0].y).toBeCloseTo(600 / 7)
    expect(L.shelf.right[5].x).toBeCloseTo(952)
    expect(L.shelf.right[5].y).toBeCloseTo((600 * 6) / 7)
  })

  it('wraps a long shelf into a second, inner column', () => {
    const wide = computeLayout(1000, 600, { left: 1, right: 12 }, 6)
    expect(wide.shelf.left).toHaveLength(1)
    expect(wide.shelf.right).toHaveLength(12)
    expect(wide.shelf.right[5]).toEqual({ x: 952, y: (600 * 6) / 7 })
    expect(wide.shelf.right[6].x).toBe(880)
    expect(wide.shelf.right[6].y).toBeCloseTo(600 / 7)
  })
})

describe('computeLayout: slots clear the shelves', () => {
  const GRAB = 1.3
  it('keeps 1000x600 with 6+6 logos unchanged', () => {
    const L = computeLayout(1000, 600, { left: 6, right: 6 }, 6)
    expect(L.slots).toEqual([{ x: 300, y: 300 }, { x: 700, y: 300 }])
    expect(L.slotRadius).toBe(72)
  })

  for (const [w, h] of [[600, 600], [1024, 768]]) {
    it(`grab disks never overlap and slots stay fuse-safe at ${w}x${h}`, () => {
      const L = computeLayout(w, h, { left: 1, right: 12 }, 6)
      const need = GRAB * L.shelfRadius + GRAB * L.slotRadius
      for (const slot of L.slots) {
        for (const side of ['left', 'right'] as const) {
          for (const p of L.shelf[side]) expect(Math.hypot(p.x - slot.x, p.y - slot.y)).toBeGreaterThanOrEqual(need)
        }
      }
      expect(L.slots[1].x - L.slots[0].x).toBeGreaterThanOrEqual(2.6 * L.slotRadius)
      expect(L.cardRadius).toBe(Math.round(L.slotRadius * 1.5))
    })
  }
})
