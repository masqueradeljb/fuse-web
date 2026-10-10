import { existsSync, readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { createSiteJobs, SiteRef } from './jobs'

type Jobs = ReturnType<typeof createSiteJobs>

const PAGE_CSP = [
  "default-src 'none'",
  "img-src 'self' https: data:",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "media-src https:",
  "font-src https://fonts.gstatic.com data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ')

const isRef = (v: unknown): v is SiteRef =>
  typeof v === 'object' && v !== null &&
  ['id', 'name', 'url'].every((k) => typeof (v as Record<string, unknown>)[k] === 'string') &&
  /^https?:\/\//.test((v as SiteRef).url)

/** Mounted at /api/fuse-site. a = content (left slot), b = style (right slot). */
export function createSiteHandler(jobs: Jobs) {
  return async function handleSite(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const id = url.searchParams.get('id') ?? ''
    const validId = /^[a-f0-9]{16}$/.test(id)
    try {
      if (req.method === 'POST' && url.pathname === '/') {
        const body = JSON.parse(await readBody(req)) as { a?: unknown; b?: unknown }
        if (!isRef(body.a) || !isRef(body.b)) return sendJson(res, 400, { error: 'expected { a: {id,name,url}, b: {id,name,url} }' })
        return sendJson(res, 200, jobs.start(body.a, body.b))
      }
      if (req.method === 'GET' && url.pathname === '/status') {
        return sendJson(res, 200, validId ? jobs.status(id) : { status: 'unknown' })
      }
      if (req.method === 'POST' && url.pathname === '/cancel') {
        if (validId) jobs.cancel(id)
        return sendJson(res, 200, { ok: true })
      }
      if (req.method === 'GET' && url.pathname === '/page') {
        const file = jobs.pageFile(id)
        if (!validId || !existsSync(file)) return sendJson(res, 404, { error: 'page not ready' })
        res.statusCode = 200
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.setHeader('content-security-policy', PAGE_CSP)
        res.setHeader('cache-control', 'no-store')
        return void res.end(readFileSync(file))
      }
      if (req.method === 'GET' && url.pathname === '/hero') {
        if (!validId) return sendJson(res, 404, { error: 'unknown hero' })
        const file = jobs.heroFile(id)
        if (existsSync(file)) {
          res.statusCode = 200
          res.setHeader('content-type', 'image/png')
          res.setHeader('cache-control', 'no-store')
          return void res.end(readFileSync(file))
        }
        const fallback = jobs.heroFallback(id)
        if (fallback) {
          res.statusCode = 302
          res.setHeader('location', fallback)
          return void res.end()
        }
        return sendJson(res, 404, { error: 'hero not available' })
      }
      sendJson(res, 404, { error: 'not found' })
    } catch {
      sendJson(res, 400, { error: 'bad request' })
    }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 100_000) {
        reject(new Error('too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}
