import type { Site } from '../types'
import type { FuseClient, FuseResult } from './FuseClient'
import { renderLogoPng } from './logoPng'

/** The dev server has no OpenAI key: callers fall back to the placeholder. */
export class NoKeyError extends Error {}

/** Left slot (a) gives the subject, right slot (b) the style. */
export class AiFuseClient implements FuseClient {
  async fuse(a: Site, b: Site, signal?: AbortSignal): Promise<FuseResult> {
    const [pngA, pngB] = await Promise.all([renderLogoPng(a), renderLogoPng(b)])
    const res = await fetch('/api/fuse-logo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: { id: a.id, name: a.name, png: pngA }, b: { id: b.id, name: b.name, png: pngB } }),
      signal,
    })
    const body = (await res.json().catch(() => ({}))) as { logoUrl?: string; error?: string }
    if (res.status === 503) throw new NoKeyError(body.error ?? 'No OpenAI key on the dev server')
    if (!res.ok || !body.logoUrl) throw new Error(body.error ?? `Fusion failed (HTTP ${res.status})`)
    return { siteA: a.id, siteB: b.id, label: `${a.name} × ${b.name}`, logoUrl: body.logoUrl }
  }
}
