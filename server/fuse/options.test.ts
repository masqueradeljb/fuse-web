import { describe, expect, it } from 'vitest'
import { fuseOptionsFrom } from './options'

describe('fuseOptionsFrom', () => {
  it('has demo defaults', () => {
    expect(fuseOptionsFrom({})).toEqual({
      apiKey: undefined,
      model: 'gpt-image-2.5-sunburst',
      quality: 'medium',
      size: '512x512',
      maxGenerations: 50,
    })
  })
  it('reads overrides', () => {
    const o = fuseOptionsFrom({
      OPENAI_API_KEY: 'test-key',
      FUSE_IMAGE_MODEL: 'gpt-image-2.5-flare',
      FUSE_IMAGE_QUALITY: 'high',
      FUSE_IMAGE_SIZE: '1024x1024',
      FUSE_MAX_GENERATIONS: '3',
    })
    expect(o).toEqual({ apiKey: 'test-key', model: 'gpt-image-2.5-flare', quality: 'high', size: '1024x1024', maxGenerations: 3 })
  })
  it('ignores blank or invalid values', () => {
    const o = fuseOptionsFrom({ OPENAI_API_KEY: '  ', FUSE_MAX_GENERATIONS: 'lots', FUSE_IMAGE_SIZE: 'big' })
    expect(o.apiKey).toBeUndefined()
    expect(o.maxGenerations).toBe(50)
    expect(o.size).toBe('512x512')
  })
})
