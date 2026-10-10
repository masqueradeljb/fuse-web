import { describe, expect, it } from 'vitest'
import { PER_SHELF, SITES } from './sites'

describe('SITES', () => {
  it('fills both shelves', () => {
    expect(SITES).toHaveLength(PER_SHELF * 2)
  })

  it('has unique ids, hex colors and icon paths', () => {
    expect(new Set(SITES.map((s) => s.id)).size).toBe(SITES.length)
    for (const s of SITES) {
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(s.iconPath.length).toBeGreaterThan(10)
      expect(s.url).toMatch(/^https:\/\//)
    }
  })
})
