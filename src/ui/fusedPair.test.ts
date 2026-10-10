import { describe, expect, it } from 'vitest'
import type { Site } from '../types'
import { readFusedPair, saveFusedPair } from './fusedPair'

const a: Site = { id: 'mine.com', name: 'Mine', url: 'https://mine.com/', color: '#123456', logoUrl: '/api/logo/img?id=mine.com' }
const b: Site = { id: 'spotify', name: 'Spotify', url: 'https://www.spotify.com', color: '#1ED760', iconPath: 'M0 0' }

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    },
  }
}

describe('fusedPair', () => {
  it('round-trips a pair under its id', () => {
    const s = memoryStorage()
    const id = saveFusedPair(a, b, s)
    expect(id).toBe('mine.com__spotify')
    expect(readFusedPair(id, s)).toEqual({ a, b })
  })
  it('removes other stored pairs when saving a new one', () => {
    const s = memoryStorage()
    const idA = saveFusedPair(a, b, s)
    s.setItem('other-key', 'keep')
    const c: Site = { ...a, id: 'other.com' }
    const idB = saveFusedPair(c, b, s)
    expect(readFusedPair(idA, s)).toBeNull()
    expect(readFusedPair(idB, s)).toEqual({ a: c, b })
    expect(s.getItem('other-key')).toBe('keep')
  })
  it('stores the fused logo with the pair', () => {
    const s = memoryStorage()
    const id = saveFusedPair(a, b, s, '/api/fuse-logo/img?id=mine.com__spotify')
    expect(readFusedPair(id, s)).toEqual({ a, b, logoUrl: '/api/fuse-logo/img?id=mine.com__spotify' })
  })
  it('returns null for unknown or corrupt entries', () => {
    const s = memoryStorage()
    expect(readFusedPair('x__y', s)).toBeNull()
    s.setItem('fuse-web:pair:bad', '{')
    expect(readFusedPair('bad', s)).toBeNull()
  })
})
