import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { costOf, type Usage } from './cost'
import type { FuseOptions } from './options'
import { buildFusePrompt } from './prompt'

const OPENAI_EDITS = 'https://api.openai.com/v1/images/edits'
const TIMEOUT_MS = 120_000
const MAX_BODY = 6_000_000
const MAX_IMAGE = 2_000_000
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/

interface Side {
  id: string
  name: string
  png: string
}

/** Pair ids become file names: keep them boring. */
const safeId = (id: string) => id.toLowerCase().replace(/[^a-z0-9._-]/g, '_').replace(/^\.+/, '_').slice(0, 80)

/**
 * Mounted at /api/fuse-logo:
 *   POST /          { a, b } → { id, logoUrl, cached, usd? }
 *   GET  /img?id=…  the fused PNG
 * `a` (left slot) gives the subject, `b` (right slot) the style.
 */
export function createFuseHandler(options: FuseOptions, cacheDir: string) {
  let generations = 0

  return async function handleFuse(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (req.method === 'GET' && url.pathname === '/img') return sendImage(res, url.searchParams.get('id') ?? '')
      if (req.method !== 'POST' || url.pathname !== '/') return sendJson(res, 404, { error: 'not found' })

      let a: Side, b: Side
      try {
        ;({ a, b } = parseBody(await readBody(req)))
      } catch (err) {
        return sendJson(res, 400, { error: err instanceof Error ? err.message : 'bad request' })
      }

      const id = `${safeId(a.id)}__${safeId(b.id)}`
      const file = join(cacheDir, `${id}.png`)
      const logoUrl = `/api/fuse-logo/img?id=${encodeURIComponent(id)}&v=${Date.now()}`
      if (existsSync(file)) return sendJson(res, 200, { id, logoUrl, cached: true })

      if (!options.apiKey) return sendJson(res, 503, { error: 'OPENAI_API_KEY is not set on the dev server' })
      if (generations >= options.maxGenerations) {
        return sendJson(res, 429, { error: `Generation limit reached (${options.maxGenerations}) — restart the dev server to reset` })
      }
      generations++

      const controller = new AbortController()
      res.on('close', () => {
        if (!res.writableEnded) controller.abort()
      })
      const form = new FormData()
      form.append('model', options.model)
      form.append('prompt', buildFusePrompt(a.name, b.name))
      form.append('size', options.size)
      form.append('quality', options.quality)
      form.append('n', '1')
      form.append('image[]', pngBlob(a.png), 'subject.png')
      form.append('image[]', pngBlob(b.png), 'style.png')

      const started = Date.now()
      const r = await fetch(OPENAI_EDITS, {
        method: 'POST',
        headers: { authorization: `Bearer ${options.apiKey}` },
        body: form,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(TIMEOUT_MS)]),
      })
      const json = (await r.json().catch(() => ({}))) as {
        data?: { b64_json?: string }[]
        usage?: Usage
        error?: { message?: string }
      }
      const b64 = json.data?.[0]?.b64_json
      if (!r.ok || !b64) return sendJson(res, 502, { error: `OpenAI: ${json.error?.message ?? `HTTP ${r.status}`}` })

      mkdirSync(cacheDir, { recursive: true })
      writeFileSync(file, Buffer.from(b64, 'base64'))
      const cost = json.usage ? costOf(options.model, json.usage) : { usd: null, exact: false }
      const usd = cost.usd === null ? 'unknown cost' : `$${cost.usd.toFixed(4)}${cost.exact ? '' : '+'}`
      console.log(`[fuse] ${a.name} × ${b.name} — ${options.model}/${options.quality}/${options.size} — ${usd} — ${((Date.now() - started) / 1000).toFixed(1)}s (${generations}/${options.maxGenerations})`)
      sendJson(res, 200, { id, logoUrl, cached: false, usd: cost.usd ?? undefined })
    } catch (err) {
      if (res.writableEnded) return
      const aborted = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
      sendJson(res, aborted ? 504 : 500, { error: aborted ? 'Fusion timed out or was cancelled' : 'Fusion failed' })
    }
  }

  function sendImage(res: ServerResponse, rawId: string): void {
    const parts = rawId.split('__')
    const id = parts.length === 2 ? parts.map(safeId).join('__') : ''
    const file = join(cacheDir, `${id}.png`)
    if (!id || id !== rawId.toLowerCase() || !existsSync(file)) return sendJson(res, 404, { error: 'unknown fusion' })
    res.statusCode = 200
    res.setHeader('content-type', 'image/png')
    res.setHeader('cache-control', 'no-store')
    res.end(readFileSync(file))
  }
}

function pngBlob(dataUrl: string): Blob {
  const m = PNG_DATA_URL.exec(dataUrl)
  return new Blob([Buffer.from(m ? m[1] : '', 'base64')], { type: 'image/png' })
}

function parseBody(raw: string): { a: Side; b: Side } {
  const value = JSON.parse(raw) as { a?: Partial<Side>; b?: Partial<Side> }
  const side = (s: Partial<Side> | undefined, label: string): Side => {
    if (!s || typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.png !== 'string') throw new Error(`missing ${label}`)
    const m = PNG_DATA_URL.exec(s.png)
    if (!m || Buffer.byteLength(m[1], 'base64') > MAX_IMAGE) throw new Error(`${label}.png must be a PNG data URL under 2 MB`)
    return { id: s.id, name: s.name, png: s.png }
  }
  return { a: side(value.a, 'a'), b: side(value.b, 'b') }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) reject(new Error('request too large'))
      else chunks.push(c)
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
