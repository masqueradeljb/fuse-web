import { describe, expect, it } from 'vitest'
import { buildFusePrompt } from './prompt'

describe('buildFusePrompt', () => {
  it('takes the subject from image 1 and the style from image 2, by name', () => {
    const p = buildFusePrompt('Mine', 'Spotify')
    expect(p).toContain('Image 1 is the logo of Mine')
    expect(p).toContain('Image 2 is the logo of Spotify')
    expect(p).toMatch(/main subject.*image 1/i)
    expect(p).toMatch(/color palette/i)
    expect(p).toMatch(/no text/i)
  })
  it('strips quotes and newlines from names', () => {
    expect(buildFusePrompt('A"\nB', 'C')).toContain('Image 1 is the logo of A B')
  })
})
