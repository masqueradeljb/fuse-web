# Phase 2 — AI Logo Fusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When two logos fuse, the dev server asks OpenAI `gpt-image-2.5-sunburst` for one new logo — the left slot's subject in the right slot's style — and the card and fused page show it.

**Architecture:** A second Vite dev-server middleware (`/api/fuse-logo`) next to `/api/logo`: pure prompt/options/cost modules plus a handler that calls `POST /v1/images/edits` with `fetch` + `FormData`, caches PNGs in `cache/fused/`, and caps generations. The browser renders both logos to 512×512 PNG data URLs, posts them via an `AiFuseClient`, and the Renderer cross-fades the result into the card.

**Tech Stack:** existing (Vite 8, TS 7, Vitest 4, Node 25 global `fetch`/`FormData`/`Blob`). No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-10-10-fuse-web-design.md` → "Phase 2 — AI logo fusion".

**Source of truth:** the code on `main`/the working branch. Where a snippet here differs slightly from a file, adapt to the file.

**Secrets rules (critical — public repo):** the OpenAI key is read only from `process.env` / Vite `loadEnv` on the server. Never log it, never send it to the browser, never write it to any file, never put it in a test fixture (tests use the literal `'test-key'`). Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push. Never kill processes you didn't start; own dev server = `npx vite --port 5299 --strictPort`, stop by PID.

---

## Files

```
server/fuse/prompt.ts         buildFusePrompt(subjectName, styleName)
server/fuse/options.ts        fuseOptionsFrom(env) → model/quality/size/max/apiKey presence
server/fuse/cost.ts           PRICE table + costOf(model, usage)
server/fuse/handler.ts        POST / (generate or cached), GET /img?id=
server/fuse/*.test.ts
server/vite-plugin-fuse.ts    mounts /api/fuse-logo on dev + preview
vite.config.ts                function config with loadEnv → fuseApi(options)
.env.example                  names only
src/fuse/logoPng.ts           renderLogoPng(site, size) → PNG data URL (DOM)
src/fuse/AiFuseClient.ts      FuseClient over /api/fuse-logo, NoKeyError, abort(fuseId)
src/fuse/FuseClient.ts        fuse(a, b, signal?) signature
src/scene/Scene.ts            onFuseDismissed, FuseState.doneAt, onOpenFused(a, b, result)
src/render/Renderer.ts        fused logo in the card with cross-fade
src/ui/fusedPair.ts           store { a, b, logoUrl? }
src/fused.ts, src/fused.css   show the fused logo large
src/main.ts                   AiFuseClient, abort on dismiss, no-key fallback banner
README.md
```

---

### Task 1: Server — `/api/fuse-logo`

- [ ] **Step 1: Failing tests `server/fuse/prompt.test.ts`, `server/fuse/options.test.ts`, `server/fuse/cost.test.ts`**

```ts
// prompt.test.ts
import { describe, expect, it } from 'vitest'
import { buildFusePrompt } from './prompt'

describe('buildFusePrompt', () => {
  it('takes the subject from image 1 and the style from image 2, by name', () => {
    const p = buildFusePrompt('Mine', 'Spotify')
    expect(p).toContain('Image 1 is the logo of Mine')
    expect(p).toContain('Image 2 is the logo of Spotify')
    expect(p).toMatch(/main subject.*image 1/i)
    expect(p).toMatch(/color palette/i)
    expect(p).toMatch(/no text/i)
  })
  it('strips quotes and newlines from names', () => {
    expect(buildFusePrompt('A"\nB', 'C')).toContain('Image 1 is the logo of A B')
  })
})
```

```ts
// options.test.ts
import { describe, expect, it } from 'vitest'
import { fuseOptionsFrom } from './options'

describe('fuseOptionsFrom', () => {
  it('has demo defaults', () => {
    expect(fuseOptionsFrom({})).toEqual({
      apiKey: undefined,
      model: 'gpt-image-2.5-sunburst',
      quality: 'medium',
      size: '512x512',
      maxGenerations: 50,
    })
  })
  it('reads overrides', () => {
    const o = fuseOptionsFrom({
      OPENAI_API_KEY: 'test-key',
      FUSE_IMAGE_MODEL: 'gpt-image-2.5-flare',
      FUSE_IMAGE_QUALITY: 'high',
      FUSE_IMAGE_SIZE: '1024x1024',
      FUSE_MAX_GENERATIONS: '3',
    })
    expect(o).toEqual({ apiKey: 'test-key', model: 'gpt-image-2.5-flare', quality: 'high', size: '1024x1024', maxGenerations: 3 })
  })
  it('ignores blank or invalid values', () => {
    const o = fuseOptionsFrom({ OPENAI_API_KEY: '  ', FUSE_MAX_GENERATIONS: 'lots', FUSE_IMAGE_SIZE: 'big' })
    expect(o.apiKey).toBeUndefined()
    expect(o.maxGenerations).toBe(50)
    expect(o.size).toBe('512x512')
  })
})
```

```ts
// cost.test.ts
import { describe, expect, it } from 'vitest'
import { costOf } from './cost'

describe('costOf', () => {
  it('prices text, image and output tokens', () => {
    const c = costOf('gpt-image-2.5-sunburst', {
      input_tokens: 1100,
      output_tokens: 1000,
      input_tokens_details: { text_tokens: 100, image_tokens: 1000 },
    })
    // 100×5 + 1000×8 + 1000×30 per 1M
    expect(c.usd).toBeCloseTo((100 * 5 + 1000 * 8 + 1000 * 30) / 1e6)
    expect(c.exact).toBe(true)
  })
  it('falls back to text price for all input without details, and null for unknown models', () => {
    expect(costOf('gpt-image-2.5-flare', { input_tokens: 1000, output_tokens: 0 }).exact).toBe(false)
    expect(costOf('mystery', { input_tokens: 1, output_tokens: 1 }).usd).toBeNull()
  })
})
```

Run `npx vitest run server/fuse` → FAIL (modules missing).

- [ ] **Step 2: `server/fuse/prompt.ts`**

```ts
const clean = (name: string) => name.replace(/["\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)

/** Image 1 (left slot) gives the subject; image 2 (right slot) gives the style. */
export function buildFusePrompt(subjectName: string, styleName: string): string {
  const a = clean(subjectName)
  const b = clean(styleName)
  return [
    `Image 1 is the logo of ${a}. Image 2 is the logo of ${b}.`,
    `Create one new logo. Keep the main subject, character and shape of image 1 as the core mark,`,
    `redrawn in the visual style of image 2: its color palette, line weight, shape language and finish.`,
    `It should read clearly as ${a}'s mark in ${b}'s style.`,
    `Flat vector logo, centered, generous padding, plain white background, no text, no letters, no mockup.`,
  ].join(' ')
}
```

- [ ] **Step 3: `server/fuse/options.ts`**

```ts
export interface FuseOptions {
  /** never logged or sent to the browser */
  apiKey: string | undefined
  model: string
  quality: string
  size: string
  maxGenerations: number
}

type Env = Record<string, string | undefined>

const nonBlank = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined)

export function fuseOptionsFrom(env: Env): FuseOptions {
  const size = nonBlank(env.FUSE_IMAGE_SIZE)
  const max = Number.parseInt(env.FUSE_MAX_GENERATIONS ?? '', 10)
  return {
    apiKey: nonBlank(env.OPENAI_API_KEY),
    model: nonBlank(env.FUSE_IMAGE_MODEL) ?? 'gpt-image-2.5-sunburst',
    quality: nonBlank(env.FUSE_IMAGE_QUALITY) ?? 'medium',
    size: size && /^\d+x\d+$/.test(size) ? size : '512x512',
    maxGenerations: Number.isFinite(max) && max >= 0 ? max : 50,
  }
}
```

- [ ] **Step 4: `server/fuse/cost.ts`**

```ts
/** USD per 1M tokens. Hard-coded on purpose so price changes show up in diffs. */
export const PRICE: Record<string, { tin: number; iin: number; out: number }> = {
  'gpt-image-2.5-sunburst': { tin: 5, iin: 8, out: 30 },
  'gpt-image-2.5-flare': { tin: 5, iin: 8, out: 30 },
  'gpt-image-2': { tin: 5, iin: 8, out: 30 },
}
export const PRICE_AS_OF = '2026-09-09'

export interface Usage {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: { text_tokens?: number; image_tokens?: number }
}

/** Without input details, all input is priced as text — a lower bound (exact: false). */
export function costOf(model: string, usage: Usage): { usd: number | null; exact: boolean } {
  const p = PRICE[model]
  const details = usage.input_tokens_details
  const text = details ? (details.text_tokens ?? 0) : (usage.input_tokens ?? 0)
  const image = details ? (details.image_tokens ?? 0) : 0
  const out = usage.output_tokens ?? 0
  return { usd: p ? (text * p.tin + image * p.iin + out * p.out) / 1e6 : null, exact: details !== undefined }
}
```

Run `npx vitest run server/fuse` → these three pass.

- [ ] **Step 5: Failing test `server/fuse/handler.test.ts`**

```ts
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
```

- [ ] **Step 6: `server/fuse/handler.ts`**

```ts
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
```

Run `npx vitest run server/fuse` → all pass. (The `parseBody` JSON error for `'{'` is caught → 400.)

- [ ] **Step 7: Plugin, config, `.env.example`**

`server/vite-plugin-fuse.ts`:
```ts
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { createFuseHandler } from './fuse/handler'
import type { FuseOptions } from './fuse/options'

const CACHE_DIR = fileURLToPath(new URL('../cache/fused', import.meta.url))

/** Serves /api/fuse-logo on the dev and preview servers. The key never leaves the server. */
export function fuseApi(options: FuseOptions): Plugin {
  const handler = createFuseHandler(options, CACHE_DIR)
  return {
    name: 'fuse-web-fuse-api',
    configureServer(server) {
      server.middlewares.use('/api/fuse-logo', (req, res) => void handler(req, res))
      server.config.logger.info(
        options.apiKey
          ? `  fuse: ${options.model} · ${options.quality} · ${options.size} · max ${options.maxGenerations} generations`
          : '  fuse: OPENAI_API_KEY not set — fusing shows a placeholder',
      )
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/fuse-logo', (req, res) => void handler(req, res))
    },
  }
}
```

`vite.config.ts` → function form (keep the existing build/test settings):
```ts
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { fuseOptionsFrom } from './server/fuse/options'
import { logoApi } from './server/vite-plugin-logo'
import { fuseApi } from './server/vite-plugin-fuse'

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url))

export default defineConfig(({ mode }) => {
  // '' prefix: also reads non-VITE_ vars (server-only; never exposed to the bundle)
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') }
  return {
    plugins: [logoApi(), fuseApi(fuseOptionsFrom(env))],
    build: { rollupOptions: { input: { main: page('./index.html'), fused: page('./fused.html') } } },
    test: { environment: 'node', include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
  }
})
```

`.env.example`:
```
# Copy to .env (git-ignored) or export these in your shell before `npm run dev`.
# The key is only read by the dev server; it is never sent to the browser.
OPENAI_API_KEY=

# Optional
FUSE_IMAGE_MODEL=gpt-image-2.5-sunburst
FUSE_IMAGE_QUALITY=medium
FUSE_IMAGE_SIZE=512x512
FUSE_MAX_GENERATIONS=50
```

Confirm `git check-ignore -v .env cache/fused/x.png` reports both ignored and `git check-ignore .env.example` reports nothing.

- [ ] **Step 8: Verify and commit**

`npm run typecheck && npx vitest run server && npm run build` → all pass. Bundle check: `grep -rl "OPENAI_API_KEY\|sk-" dist/ || echo "no key refs in bundle"` → `no key refs in bundle`.

```bash
git add server vite.config.ts .env.example
git commit -m "feat: /api/fuse-logo — OpenAI gpt-image-2.5 fusion, cached, capped"
```

---

### Task 2: Scene and stored pair

**Files:** `src/fuse/FuseClient.ts`, `src/scene/Scene.ts`, `src/scene/Scene.test.ts`, `src/ui/fusedPair.ts`, `src/ui/fusedPair.test.ts`

- [ ] **Step 1: Tests first**

Scene (append to the fuse tests; `setup()` gains `onFuseDismissed: vi.fn()` and returns it):
```ts
  it('reports the dismissed fuse id so the request can be cancelled', () => {
    const { scene, onFuseDismissed, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    const id = scene.fuse!.id
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 500, 580, true)])
    expect(onFuseDismissed).toHaveBeenCalledWith(id)
  })

  it('records when the result arrived and passes it to onOpenFused', () => {
    const { scene, onOpenFused, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    const result = { siteA: 's0', siteB: 's6', label: 'x', logoUrl: '/api/fuse-logo/img?id=s0__s6' }
    scene.setFuseResult(scene.fuse!.id, result)
    expect(scene.fuse!.doneAt).toBe(scene.now)
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 500, 40, true)])
    expect(onOpenFused.mock.calls[0][2]).toEqual(result)
  })
```

fusedPair:
```ts
  it('stores the fused logo with the pair', () => {
    const s = memoryStorage()
    const id = saveFusedPair(a, b, s, '/api/fuse-logo/img?id=mine.com__spotify')
    expect(readFusedPair(id, s)).toEqual({ a, b, logoUrl: '/api/fuse-logo/img?id=mine.com__spotify' })
  })
```
and update existing fusedPair assertions from `[a, b]` to `{ a, b }` (no `logoUrl` key when not given — use `toEqual({ a, b })`, which ignores an undefined property).

- [ ] **Step 2: Implement**
- `FuseClient.fuse(a: Site, b: Site, signal?: AbortSignal): Promise<FuseResult>`; `PlaceholderFuseClient` accepts and ignores `signal`.
- `SceneOptions.onFuseDismissed?: (fuseId: number) => void`; call it with the fuse id when the bottom zone dismisses the card.
- `FuseState.doneAt?: number`; `setFuseResult` sets it to `this.now`.
- `SceneOptions.onOpenFused: (a: Site, b: Site, result: FuseResult | null) => void`; pass `f.result`.
- `saveFusedPair(a, b, storage = localStorage, logoUrl?: string)` stores `{ a, b, logoUrl }`; `readFusedPair` returns `{ a: Site; b: Site; logoUrl?: string } | null` (validate `a`/`b` are objects with string `id`).

- [ ] **Step 3: Verify and commit**

`npx vitest run src/scene src/ui` → pass. Typecheck may fail in `src/main.ts`/`src/fused.ts` until Task 3 — check `npx tsc --noEmit 2>&1 | grep -v -E 'src/(main|fused)\.ts'` is empty.

```bash
git add src/fuse/FuseClient.ts src/scene src/ui
git commit -m "feat: scene reports dismissals and result timing; fused pair carries the logo"
```

---

### Task 3: Browser — AI client, card, fused page

**Files:** create `src/fuse/logoPng.ts`, `src/fuse/AiFuseClient.ts`; modify `src/render/Renderer.ts`, `src/main.ts`, `src/fused.ts`, `src/fused.css`, `README.md`

- [ ] **Step 1: `src/fuse/logoPng.ts`**

```ts
import { logoSrc } from '../render/logoImages'
import type { Site } from '../types'

/**
 * The logo as the model should see it: a square PNG data URL. Reference sites: glyph on
 * their brand color (that color is the style we want carried over). Your sites: the logo
 * on white (or its dark backing).
 */
export async function renderLogoPng(site: Site, size = 512): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error(`Could not load the ${site.name} logo`))
    el.src = logoSrc(site)
  })
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  ctx.fillStyle = site.logoUrl ? (site.logoBg ?? '#ffffff') : site.color
  ctx.fillRect(0, 0, size, size)
  const box = size * 0.7
  const w = img.naturalWidth || box
  const h = img.naturalHeight || box
  const k = box / Math.max(w, h)
  ctx.drawImage(img, (size - w * k) / 2, (size - h * k) / 2, w * k, h * k)
  return canvas.toDataURL('image/png')
}
```

- [ ] **Step 2: `src/fuse/AiFuseClient.ts`**

```ts
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
```

- [ ] **Step 3: Renderer — fused logo in the card**

Add `private results = new Map<string, HTMLImageElement>()` and a helper:
```ts
  private resultImage(url: string): HTMLImageElement {
    let img = this.results.get(url)
    if (!img) {
      img = new Image()
      img.src = url
      this.results.set(url, img)
    }
    return img
  }
```
In `drawFuse`, in the non-fusing branch: if `f.status === 'done' && f.result?.logoUrl`, get the image; when loaded (`complete && naturalWidth > 0`), draw a white disc of radius `R * 0.9` at `p`, clip to it, and draw the image covering the disc (square fit to `R * 1.8`), with `globalAlpha = min(1, (scene.now - (f.doneAt ?? scene.now)) / 400)`; draw the two small logos underneath at `1 - alpha` so it cross-fades. If not loaded yet, keep drawing the two logos.

- [ ] **Step 4: `src/main.ts`**
- `const fuseClient = new AiFuseClient()` and keep a `const fallback = new PlaceholderFuseClient(0)`.
- `const pending = new Map<number, AbortController>()`.
- `onFuse: (a, b, fuseId)` → create an `AbortController`, store it, call `fuseClient.fuse(a, b, ctrl.signal)`:
  - success → `scene?.setFuseResult(fuseId, result)`
  - `NoKeyError` → `showBanner('No OPENAI_API_KEY on the dev server — showing a placeholder fuse.', 6000)` once per session, then `fallback.fuse(a, b).then(r => scene?.setFuseResult(fuseId, r))`
  - `AbortError` → ignore
  - other errors → `console.error`, `showBanner(message, 6000)`, `scene?.setFuseError(fuseId)`
  - `finally` → `pending.delete(fuseId)`
- `onFuseDismissed: (fuseId) => { pending.get(fuseId)?.abort(); pending.delete(fuseId) }`.
- `onOpenFused: (a, b, result) => openFused(a, b, overlay, onBlocked, result?.logoUrl)`; update `openFused` in `src/ui/fusedView.ts` to accept `logoUrl?: string` and pass it to `saveFusedPair`.

- [ ] **Step 5: Fused page**

`src/fused.ts`: use `readFusedPair(...)` → `{ a, b, logoUrl }`. If `logoUrl`, render it first as `<img class="fused-logo" alt="Fused logo">` (240×240, rounded, white background) above the two small source logos (make those 64px when a fused logo exists). Title stays `A × B`; note becomes "Fused logo — the full fused site is coming soon." when a logo exists. CSS in `src/fused.css` for `.fused-logo`.

- [ ] **Step 6: README** — a "Fusion (OpenAI)" section: set `OPENAI_API_KEY` in your shell or `.env` (copy `.env.example`); left slot = subject, right slot = style; results cached in `cache/fused/`; console shows cost per generation; `FUSE_MAX_GENERATIONS` caps a run (default 50); without a key you get the placeholder. State that the key is only read by the dev server.

- [ ] **Step 7: Verify and commit**

`npm run typecheck && npm test && npm run build`; bundle check `grep -rl "OPENAI_API_KEY\|sk-" dist/ || echo "no key refs in bundle"`; secret scan:
```bash
git grep -n -I -E 'sk-[A-Za-z0-9_-]{20,}|AIza|-----BEGIN' -- . ':!package-lock.json' || echo clean
```

```bash
git add src README.md
git commit -m "feat: AI fusion in the app — fused logo in the card and fused page"
```

---

### Task 4: One live generation (controller, with the owner's OK — granted)

- [ ] Start `npx vite --port 5299 --strictPort` in the background (shell has `OPENAI_API_KEY`). POST two small real logos (e.g. render via a tiny node script from `cache`-free sources, or reuse `/api/logo` for `github.com` + a reference glyph PNG) to `/api/fuse-logo`. Expect 200 within ~60 s and a `[fuse] … $…` console line. If the API rejects `512x512`, set `FUSE_IMAGE_SIZE` default to the smallest size the error message allows, update `options.ts`/tests, and retry once.
- [ ] Open the result PNG to eyeball it; report cost and latency. Stop the server by PID.
