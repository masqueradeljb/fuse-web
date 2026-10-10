import { describe, expect, it } from 'vitest'
import { costOf } from './cost'

describe('costOf', () => {
  it('prices text, image and output tokens', () => {
    const c = costOf('gpt-image-2.5-sunburst', {
      input_tokens: 1100,
      output_tokens: 1000,
      input_tokens_details: { text_tokens: 100, image_tokens: 1000 },
    })
    // 100×5 + 1000×8 + 1000×30 per 1M
    expect(c.usd).toBeCloseTo((100 * 5 + 1000 * 8 + 1000 * 30) / 1e6)
    expect(c.exact).toBe(true)
  })
  it('falls back to text price for all input without details, and null for unknown models', () => {
    expect(costOf('gpt-image-2.5-flare', { input_tokens: 1000, output_tokens: 0 }).exact).toBe(false)
    expect(costOf('mystery', { input_tokens: 1, output_tokens: 1 }).usd).toBeNull()
  })
})
