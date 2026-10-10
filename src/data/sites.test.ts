import { describe, expect, it } from 'vitest'
import { SHELF_ROWS, REFERENCE_SITES } from './sites'

describe('REFERENCE_SITES', () => {
  it('fills both shelves', () => {
    expect(REFERENCE_SITES).toHaveLength(SHELF_ROWS * 2)
  })

  it('has unique ids, hex colors and icon paths', () => {
    expect(new Set(REFERENCE_SITES.map((s) => s.id)).size).toBe(REFERENCE_SITES.length)
    for (const s of REFERENCE_SITES) {
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect((s.iconPath ?? '').length).toBeGreaterThan(10)
      expect(s.url).toMatch(/^https:\/\//)
    }
  })
})
