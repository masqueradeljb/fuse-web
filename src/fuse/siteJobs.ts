import type { Site } from '../types'

export type PageStatus = 'capturing' | 'generating' | 'ready' | 'error' | 'unknown'

const ref = (s: Site) => ({ id: s.id, name: s.name, url: s.url })

/** a = content (left slot), b = style (right slot). */
export async function startSite(a: Site, b: Site): Promise<{ id: string; status: PageStatus; error?: string }> {
  const res = await fetch('/api/fuse-site', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ a: ref(a), b: ref(b) }),
  })
  if (!res.ok) throw new Error(`site job failed to start (HTTP ${res.status})`)
  return res.json()
}

export async function siteStatus(id: string): Promise<{ status: PageStatus; error?: string }> {
  const res = await fetch(`/api/fuse-site/status?id=${encodeURIComponent(id)}`)
  return res.ok ? res.json() : { status: 'unknown' }
}

export function cancelSite(id: string): void {
  void fetch(`/api/fuse-site/cancel?id=${encodeURIComponent(id)}`, { method: 'POST', keepalive: true }).catch(() => {})
}

export const sitePageUrl = (id: string) => `/api/fuse-site/page?id=${encodeURIComponent(id)}`
