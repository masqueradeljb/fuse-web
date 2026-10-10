import type { IncomingMessage, ServerResponse } from 'node:http'
import { iconCandidates, isBlockedHost, normalizeUrl, siteName } from './parse'

const TIMEOUT_MS = 6000
const MAX_IMAGE_BYTES = 2_000_000
const MAX_CACHED = 50
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

interface CachedImage {
  type: string
  body: Buffer
}

/** site id → logo bytes, oldest first */
const images = new Map<string, CachedImage>()

/**
 * Mounted at /api/logo (the mount prefix is stripped from req.url):
 *   GET /?url=<site>   → { id, name, url, logoUrl } or { error }
 *   GET /img?id=<id>   → the cached logo bytes
 */
export async function handleLogo(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  try {
    if (url.pathname === '/img') return sendImage(res, url.searchParams.get('id') ?? '')
    if (url.pathname !== '/') return sendJson(res, 404, { error: 'not found' })

    const page = normalizeUrl(url.searchParams.get('url') ?? '')
    if (!page) return sendJson(res, 400, { error: 'Enter a public website, like example.com' })

    const html = await fetchText(page)
    const id = page.hostname.replace(/^www\./, '')
    for (const src of iconCandidates(html, page)) {
      const image = await fetchImage(src)
      if (!image) continue
      remember(id, image)
      return sendJson(res, 200, {
        id,
        name: siteName(html, page),
        url: page.href,
        logoUrl: `/api/logo/img?id=${encodeURIComponent(id)}&v=${Date.now()}`,
      })
    }
    sendJson(res, 404, { error: `Couldn't find a logo for ${id}` })
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
}

async function fetchText(page: URL): Promise<string> {
  try {
    const r = await fetch(page, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    return r.ok ? await r.text() : ''
  } catch {
    return ''
  }
}

async function fetchImage(src: string): Promise<CachedImage | null> {
  try {
    const target = new URL(src)
    if (!/^https?:$/.test(target.protocol) || isBlockedHost(target.hostname)) return null
    const r = await fetch(target, { headers: { 'user-agent': UA, accept: 'image/*' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    const type = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!r.ok || !type.startsWith('image/')) return null
    const body = Buffer.from(await r.arrayBuffer())
    return body.length > 0 && body.length <= MAX_IMAGE_BYTES ? { type, body } : null
  } catch {
    return null
  }
}

function remember(id: string, image: CachedImage): void {
  images.delete(id)
  images.set(id, image)
  while (images.size > MAX_CACHED) images.delete(images.keys().next().value as string)
}

function sendImage(res: ServerResponse, id: string): void {
  const image = images.get(id)
  if (!image) return sendJson(res, 404, { error: 'unknown logo' })
  res.statusCode = 200
  res.setHeader('content-type', image.type)
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  // SVGs from other sites: never let them run anything if opened directly
  res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
  res.end(image.body)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}
