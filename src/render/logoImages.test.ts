import { describe, expect, it } from 'vitest'
import { glyphColor, logoSrc } from './logoImages'

describe('glyphColor', () => {
  it('uses white on dark or saturated brand colors', () => {
    expect(glyphColor('#000000')).toBe('#ffffff')
    expect(glyphColor('#1ED760')).toBe('#ffffff')
    expect(glyphColor('#FF5A5F')).toBe('#ffffff')
  })

  it('uses black on very light brand colors', () => {
    expect(glyphColor('#FFFFFF')).toBe('#000000')
    expect(glyphColor('#FFFC00')).toBe('#000000')
  })
})

describe('logoSrc', () => {
  it('uses the fetched logo for your sites', () => {
    expect(logoSrc({ id: 'a', name: 'A', url: '', color: '#000000', logoUrl: '/api/logo/img?id=a' })).toBe('/api/logo/img?id=a')
  })
  it('builds an SVG data URL for reference sites', () => {
    expect(logoSrc({ id: 'b', name: 'B', url: '', color: '#000000', iconPath: 'M0 0h24v24H0z' })).toMatch(/^data:image\/svg\+xml/)
  })
})
