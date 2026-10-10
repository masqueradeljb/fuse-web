import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFuseHandler } from './handler'
import type { FuseOptions } from './options'

const PNG_B64 = Buffer.from([137, 80, 78, 71, 1, 2, 3]).toString('base64')
const dataUrl = `data:image/png;base64,${PNG_B64}`
const body = (over: object = {}) =>
  JSON.stringify({ a: { id: 'mine.com', name: 'Mine', png: dataUrl }, b: { id: 'spotify', name: 'Spotify', png: dataUrl }, ...over })

function call(handler: ReturnType<typeof createFuseHandler>, method: string, url: string, payload?: string) {
  const req = Object.assign(new PassThrough(), { method, url }) as unknown as IncomingMessage
  const res = { statusCode: 0, headers: {} as Record<string, string>, body: undefined as unknown, closeHandlers: [] as (() => void)[] }
  const fake = {
    set statusCode(v: number) { res.statusCode = v },
    get statusCode() { return res.statusCode },
    writableEnded: false,
    setHeader: (k: string, v: string) => { res.headers[k.toLowerCase()] = v },
    end(b?: unknown) { res.body = b; this.writableEnded = true },
    on: (ev: string, fn: () => void) => { if (ev === 'close') res.closeHandlers.push(fn) },
  }
  const done = handler(req, fake as unknown as ServerResponse).then(() => res)
  ;(req as unknown as PassThrough).end(payload ?? '')
  return done
}

const options = (over: Partial<FuseOptions> = {}): FuseOptions => ({
  apiKey: 'test-key', model: 'gpt-image-2.5-sunburst', quality: 'medium', size: '512x512', maxGenerations: 5, ...over,
})

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fuse-')) })
afterEach(() => { vi.unstubAllGlobals(); rmSync(dir, { recursive: true, force: true }) })

function stubOpenAI() {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }], usage: { input_tokens: 10, output_tokens: 20 } }), {
      headers: { 'content-type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('fuse handler', () => {
  it('generates, caches to disk, and serves the image', async () => {
    const fetchMock = stubOpenAI()
    const h = createFuseHandler(options(), dir)
    const res = await call(h, 'POST', '/', body())
    expect(res.statusCode).toBe(200)
    const json = JSON.parse(String(res.body))
    expect(json).toMatchObject({ id: 'mine.com__spotify', cached: false, logoUrl: expect.stringMatching(/^\/api\/fuse-logo\/img\?id=mine\.com__spotify/) })
    expect(existsSync(join(dir, 'mine.com__spotify.png'))).toBe(true)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/images/edits')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key')
    const form = init.body as FormData
    expect(form.get('model')).toBe('gpt-image-2.5-sunburst')
    expect(form.get('size')).toBe('512x512')
    expect(form.getAll('image[]')).toHaveLength(2)
    expect(String(form.get('prompt'))).toContain('Image 1 is the logo of Mine')

    const img = await call(h, 'GET', '/img?id=mine.com__spotify')
    expect(img.statusCode).toBe(200)
    expect(img.headers['content-type']).toBe('image/png')
  })

  it('returns a cached pair without calling OpenAI, and order matters', async () => {
    const fetchMock = stubOpenAI()
    const h = createFuseHandler(options(), dir)
    await call(h, 'POST', '/', body())
    const again = JSON.parse(String((await call(h, 'POST', '/', body())).body))
    expect(again.cached).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const swapped = { a: { id: 'spotify', name: 'Spotify', png: dataUrl }, b: { id: 'mine.com', name: 'Mine', png: dataUrl } }
    await call(h, 'POST', '/', JSON.stringify(swapped))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('503 without a key; 429 past the cap; 400 for bad input', async () => {
    stubOpenAI()
    expect((await call(createFuseHandler(options({ apiKey: undefined }), dir), 'POST', '/', body())).statusCode).toBe(503)
    const capped = createFuseHandler(options({ maxGenerations: 0 }), dir)
    expect((await call(capped, 'POST', '/', body())).statusCode).toBe(429)
    const h = createFuseHandler(options(), dir)
    expect((await call(h, 'POST', '/', '{')).statusCode).toBe(400)
    expect((await call(h, 'POST', '/', body({ a: { id: 'x', name: 'X', png: 'https://evil/x.png' } }))).statusCode).toBe(400)
  })

  it('rejects path traversal in image ids', async () => {
    const h = createFuseHandler(options(), dir)
    expect((await call(h, 'GET', '/img?id=..%2F..%2Fetc%2Fpasswd')).statusCode).toBe(404)
  })

  it('passes OpenAI errors through as 502 without leaking the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid size' } }), { status: 400 })))
    const res = await call(createFuseHandler(options(), dir), 'POST', '/', body())
    expect(res.statusCode).toBe(502)
    expect(String(res.body)).toContain('Invalid size')
    expect(String(res.body)).not.toContain('test-key')
  })
})
