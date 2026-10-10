import { describe, expect, it } from 'vitest'
import type { Site } from '../types'
import { readFusedPair, saveFusedPair } from './fusedPair'

const a: Site = { id: 'mine.com', name: 'Mine', url: 'https://mine.com/', color: '#123456', logoUrl: '/api/logo/img?id=mine.com' }
const b: Site = { id: 'spotify', name: 'Spotify', url: 'https://www.spotify.com', color: '#1ED760', iconPath: 'M0 0' }

function memoryStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('fusedPair', () => {
  it('round-trips a pair under its id', () => {
    const s = memoryStorage()
    const id = saveFusedPair(a, b, s)
    expect(id).toBe('mine.com__spotify')
    expect(readFusedPair(id, s)).toEqual([a, b])
  })
  it('returns null for unknown or corrupt entries', () => {
    const s = memoryStorage()
    expect(readFusedPair('x__y', s)).toBeNull()
    s.setItem('fuse-web:pair:bad', '{')
    expect(readFusedPair('bad', s)).toBeNull()
  })
})
