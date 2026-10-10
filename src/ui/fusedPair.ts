import type { Site } from '../types'

const KEY = 'fuse-web:pair:'

type Reader = Pick<Storage, 'getItem'>
type Writer = Pick<Storage, 'setItem' | 'removeItem' | 'key' | 'length'>

/** Stores the pair for the fused page (a new tab shares localStorage) and returns its id. */
export function saveFusedPair(a: Site, b: Site, storage: Writer = localStorage, logoUrl?: string): string {
  const id = `${a.id}__${b.id}`
  try {
    // keep storage small: logos are data URLs, so only the latest pair is kept
    const stale: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k?.startsWith(KEY) && k !== KEY + id) stale.push(k)
    }
    for (const k of stale) storage.removeItem(k)
    storage.setItem(KEY + id, JSON.stringify({ a, b, logoUrl }))
  } catch {
    // storage blocked or full: the fused page shows its fallback
  }
  return id
}

export interface FusedPair {
  a: Site
  b: Site
  logoUrl?: string
}

const isSite = (v: unknown): v is Site => typeof v === 'object' && v !== null && typeof (v as Site).id === 'string'

export function readFusedPair(id: string, storage: Reader = localStorage): FusedPair | null {
  try {
    const v = JSON.parse(storage.getItem(KEY + id) ?? 'null') as Partial<FusedPair> | null
    if (!v || !isSite(v.a) || !isSite(v.b)) return null
    return { a: v.a, b: v.b, logoUrl: typeof v.logoUrl === 'string' ? v.logoUrl : undefined }
  } catch {
    return null
  }
}
