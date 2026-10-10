import { describe, expect, it } from 'vitest'
import type { Site } from '../types'
import { PlaceholderFuseClient } from './FuseClient'

const site = (id: string, name: string): Site => ({ id, name, url: `https://${id}.com`, color: '#000000', iconPath: '' })

describe('PlaceholderFuseClient', () => {
  it('resolves a labelled result for the pair', async () => {
    const r = await new PlaceholderFuseClient(0).fuse(site('spotify', 'Spotify'), site('airbnb', 'Airbnb'))
    expect(r).toEqual({ siteA: 'spotify', siteB: 'airbnb', label: 'Spotify × Airbnb' })
  })
})
