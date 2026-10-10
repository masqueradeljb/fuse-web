import { describe, expect, it } from 'vitest'
import { assignIds } from './assignIds'

describe('assignIds', () => {
  it('gives new hands fresh ids', () => {
    expect(assignIds([], [{ x: 0, y: 0 }, { x: 500, y: 0 }], 1, 200)).toEqual({ ids: [1, 2], nextId: 3 })
  })

  it('matches each hand to the nearest previous wrist regardless of order', () => {
    const prev = [
      { id: 1, wrist: { x: 100, y: 100 } },
      { id: 2, wrist: { x: 800, y: 100 } },
    ]
    const out = assignIds(prev, [{ x: 790, y: 110 }, { x: 110, y: 95 }], 3, 200)
    expect(out).toEqual({ ids: [2, 1], nextId: 3 })
  })

  it('treats a jump beyond maxJump as a new hand', () => {
    const prev = [{ id: 1, wrist: { x: 100, y: 100 } }]
    expect(assignIds(prev, [{ x: 900, y: 900 }], 3, 200)).toEqual({ ids: [3], nextId: 4 })
  })
})
