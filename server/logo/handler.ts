import type { IncomingMessage, ServerResponse } from 'node:http'
import { iconCandidates, isBlockedHost, normalizeUrl, siteName } from './parse'

const TIMEOUT_MS = 6000
const MAX_IMAGE_BYTES = 2_000_000
const MAX_HTML_BYTES = 1_000_000
const MAX_REDIRECTS = 3
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

/** fetch that follows up to MAX_REDIRECTS itself, refusing non-http(s) and private targets. Null on failure. */
export async function guardedFetch(start: URL, init: RequestInit): Promise<Response | null> {
  let current = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!/^https?:$/.test(current.protocol) || isBlockedHost(current.hostname)) return null
    const r = await fetch(current, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (r.status < 300 || r.status >= 400) return r
    const location = r.headers.get('location')
    void r.body?.cancel().catch(() => {})
    if (!location) return null
    try {
      current = new URL(location, current)
    } catch {
      return null
    }
  }
  return null
}

/** Reads at most maxBytes; null if the body is larger. */
export async function readCapped(r: Response, maxBytes: number, truncate = false): Promise<Buffer | null> {
  const declared = Number(r.headers.get('content-length') ?? 0)
  if (!truncate && declared > maxBytes) {
    void r.body?.cancel().catch(() => {})
    return null
  }
  if (!r.body) return Buffer.alloc(0)
  const reader = r.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      if (!truncate) return null
      chunks.push(Buffer.from(value.subarray(0, value.length - (total - maxBytes))))
      break
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

async function fetchText(page: URL): Promise<string> {
  try {
    const r = await guardedFetch(page, { headers: { 'user-agent': UA, accept: 'text/html' } })
    if (!r || !r.ok) return ''
    return (await readCapped(r, MAX_HTML_BYTES, true))?.toString('utf8') ?? ''
  } catch {
    return ''
  }
}

async function fetchImage(src: string): Promise<CachedImage | null> {
  try {
    const r = await guardedFetch(new URL(src), { headers: { 'user-agent': UA, accept: 'image/*' } })
    if (!r) return null
    const type = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!r.ok || !type.startsWith('image/')) {
      void r.body?.cancel().catch(() => {})
      return null
    }
    const body = await readCapped(r, MAX_IMAGE_BYTES)
    return body && body.length > 0 ? { type, body } : null
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
  res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  res.end(image.body)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}
