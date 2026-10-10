import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractHtml, generatePage } from './generate'

afterEach(() => vi.unstubAllGlobals())

describe('extractHtml', () => {
  it('strips markdown fences and leading chatter', () => {
    expect(extractHtml('Sure!\n```html\n<!doctype html><html><body>x</body></html>\n```')).toBe('<!doctype html><html><body>x</body></html>')
  })
  it('throws when there is no html document', () => {
    expect(() => extractHtml('no page here')).toThrow()
  })
})

describe('generatePage', () => {
  it('calls Gemini generateContent with text + screenshots, key in a header', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '<!doctype html><html><body>ok</body></html>' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
      })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const html = await generatePage(
      { apiKey: 'test-key', model: 'gemini-3.8-flash', thinking: 'low' },
      { prompt: 'make a page', screenshots: [Buffer.from([1, 2, 3])] },
    )
    expect(html).toContain('ok')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent')
    expect(url).not.toContain('test-key')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key')
    const body = JSON.parse(String(init.body))
    const parts = body.contents[0].parts
    expect(parts[0]).toEqual({ text: 'make a page' })
    expect(parts[1]).toEqual({ inline_data: { mime_type: 'image/jpeg', data: Buffer.from([1, 2, 3]).toString('base64') } })
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' })
  })
})
