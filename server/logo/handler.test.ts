import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleLogo } from './handler'

function call(url: string) {
  const res = { statusCode: 0, headers: {} as Record<string, string>, body: undefined as unknown }
  const fake = {
    set statusCode(v: number) { res.statusCode = v },
    get statusCode() { return res.statusCode },
    setHeader: (k: string, v: string) => { res.headers[k.toLowerCase()] = v },
    end: (b?: unknown) => { res.body = b },
  }
  return handleLogo({ url } as IncomingMessage, fake as unknown as ServerResponse).then(() => res)
}

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3])

afterEach(() => vi.unstubAllGlobals())

describe('handleLogo', () => {
  it('returns site info and serves the first working icon same-origin', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | string) => {
      const u = String(input)
      if (u === 'https://example.com/') {
        return new Response('<head><title>Example | Home</title><link rel="icon" href="/broken.png"><link rel="apple-touch-icon" href="/touch.png"></head>', { headers: { 'content-type': 'text/html' } })
      }
      if (u === 'https://example.com/touch.png') return new Response(PNG, { headers: { 'content-type': 'image/png' } })
      return new Response('nope', { status: 404 })
    }))

    const info = await call('/?url=example.com')
    expect(info.statusCode).toBe(200)
    const json = JSON.parse(String(info.body))
    expect(json).toMatchObject({ id: 'example.com', name: 'Example', url: 'https://example.com/' })
    expect(json.logoUrl).toMatch(/^\/api\/logo\/img\?id=example\.com&v=\d+$/)

    const img = await call(`/img?id=example.com`)
    expect(img.statusCode).toBe(200)
    expect(img.headers['content-type']).toBe('image/png')
    expect(new Uint8Array(img.body as Buffer)).toEqual(PNG)
  })

  it('rejects private or invalid input with 400', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const res = await call('/?url=localhost')
    expect(res.statusCode).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns 404 when no candidate is an image', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })))
    const res = await call('/?url=example.org')
    expect(res.statusCode).toBe(404)
  })

  it('404s an unknown image id', async () => {
    const res = await call('/img?id=never-fetched.com')
    expect(res.statusCode).toBe(404)
  })
})
