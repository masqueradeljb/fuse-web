import { describe, expect, it } from 'vitest'
import { glyphColor } from './logoImages'

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
