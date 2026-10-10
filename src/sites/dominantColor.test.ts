import { describe, expect, it } from 'vitest'
import { dominantColor, isMostlyWhite } from './dominantColor'

const px = (...colors: [number, number, number, number][]) => new Uint8ClampedArray(colors.flat())

describe('dominantColor', () => {
  it('returns a solid color', () => {
    expect(dominantColor(px([255, 0, 0, 255], [255, 0, 0, 255]))).toBe('#ff0000')
  })
  it('ignores transparent and near-white pixels', () => {
    expect(dominantColor(px([0, 0, 255, 255], [0, 255, 0, 0], [250, 250, 250, 255]))).toBe('#0000ff')
  })
  it('weights saturated pixels over grey ones', () => {
    const c = dominantColor(px([255, 0, 0, 255], [128, 128, 128, 255], [128, 128, 128, 255]))
    expect(parseInt(c.slice(1, 3), 16)).toBeGreaterThan(200)
  })
  it('returns near-black for an all-black logo', () => {
    expect(dominantColor(px([0, 0, 0, 255], [5, 5, 5, 255]))).toBe('#111111')
  })
  it('returns the fallback when nothing is usable', () => {
    expect(dominantColor(px([0, 0, 0, 0]))).toBe('#888888')
    expect(dominantColor(px([255, 255, 255, 255]), '#123456')).toBe('#123456')
  })
})

describe('isMostlyWhite', () => {
  it('is true for an all-white opaque logo', () => {
    expect(isMostlyWhite(px([255, 255, 255, 255], [250, 250, 250, 255]))).toBe(true)
  })
  it('is false for a colored logo', () => {
    expect(isMostlyWhite(px([255, 0, 0, 255], [255, 0, 0, 255]))).toBe(false)
  })
  it('ignores transparent pixels', () => {
    expect(isMostlyWhite(px([255, 255, 255, 255], [0, 0, 0, 0], [0, 0, 0, 0]))).toBe(true)
    expect(isMostlyWhite(px([0, 0, 0, 0]))).toBe(false)
  })
})
