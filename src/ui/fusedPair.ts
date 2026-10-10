import type { Site } from '../types'

const KEY = 'fuse-web:pair:'

type Reader = Pick<Storage, 'getItem'>
type Writer = Pick<Storage, 'setItem' | 'removeItem' | 'key' | 'length'>

/** Stores the pair for the fused page (a new tab shares localStorage) and returns its id. */
export function saveFusedPair(a: Site, b: Site, storage: Writer = localStorage): string {
  const id = `${a.id}__${b.id}`
  try {
    // keep storage small: logos are data URLs, so only the latest pair is kept
    const stale: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k?.startsWith(KEY) && k !== KEY + id) stale.push(k)
    }
    for (const k of stale) storage.removeItem(k)
    storage.setItem(KEY + id, JSON.stringify([a, b]))
  } catch {
    // storage blocked or full: the fused page shows its fallback
  }
  return id
}

export function readFusedPair(id: string, storage: Reader = localStorage): [Site, Site] | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(KEY + id) ?? 'null')
    return Array.isArray(value) && value.length === 2 ? (value as [Site, Site]) : null
  } catch {
    return null
  }
}
