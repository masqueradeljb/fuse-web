# Phase 1.5 — Your Site vs. Reference Sites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A start page where the user enters their site; the dev server fetches its logo; the stage puts the user's sites on the left and 12 reference sites on the right; the result card opens a fused page when pulled up and is dismissed when pulled down.

**Architecture:** A Vite dev-server middleware (`server/`) serves `/api/logo` (HTML fetch → icon candidates → same-origin image). The pure `Scene` gains per-side shelves, `addLeftSite`, side-locked slots and top/bottom card zones. The browser adds a start form, a `+ site` box, a dominant-color sampler, and a `fused.html` placeholder page opened via `window.open` with an in-app overlay fallback.

**Tech Stack:** existing (Vite 8, TypeScript 7, Vitest 4, MediaPipe, simple-icons) + `@types/node` for the middleware.

**Spec:** `docs/superpowers/specs/2026-10-10-fuse-web-design.md` → "Phase 1.5 — your site vs. reference sites".

**Source of truth:** the code on branch `phase1-gesture`. Where this plan shows an "existing" snippet that differs slightly from the file, adapt to the file.

**Public repo rules:** no secrets, personal info, internal names or absolute paths in code, comments or commits. Commit with trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.

---

## File structure (new/changed)

```
server/logo/parse.ts          normalizeUrl, isBlockedHost, parseTags, iconCandidates, siteName (pure)
server/logo/parse.test.ts
server/logo/handler.ts        connect-style handler for /api/logo and /api/logo/img
server/logo/handler.test.ts
server/vite-plugin-logo.ts    mounts the handler on dev + preview servers
vite.config.ts                plugin, multi-page build, server tests
tsconfig.json                 include server/, node types
src/config.ts                 dismissEdge → cardZone
src/scene/layout.ts           per-side counts, 2-column shelves
src/scene/Scene.ts            leftSites/rightSites, addLeftSite, side-locked slots, card zones
src/types.ts                  Site.iconPath optional, Site.logoUrl
src/data/sites.ts             REFERENCE_SITES, SHELF_ROWS
src/render/logoImages.ts      logoSrc, logoImage (glyph or fetched logo)
src/render/Renderer.ts        addSite, white-circle user logos, zone hints, status text
src/sites/dominantColor.ts    saturation-weighted color from RGBA (pure)
src/sites/userSite.ts         fetchUserSite(input) → Site
src/ui/siteForm.ts            bindSiteForm(form, status, onSite)
src/ui/fusedPair.ts           save/read the pair in localStorage (pure w/ injectable storage)
src/ui/fusedView.ts           openFused (window.open → overlay fallback), bindOverlayClose
src/debug/DebugPanel.ts       ignore keys typed into inputs
src/main.ts                   start page → stage, + site, open fused
index.html, src/style.css     start page, + site box, overlay
fused.html, src/fused.ts, src/fused.css   placeholder fused page
README.md
```

---

### Task 1: Logo API (server)

**Files:**
- Create: `server/logo/parse.ts`, `server/logo/parse.test.ts`, `server/logo/handler.ts`, `server/logo/handler.test.ts`, `server/vite-plugin-logo.ts`
- Modify: `vite.config.ts`, `tsconfig.json`, `package.json` (dev dep)

- [ ] **Step 1: Install node types**

Run: `npm install -D @types/node`

- [ ] **Step 2: Update `tsconfig.json`**

Set `"types": ["vite/client", "node"]` and `"include": ["src", "server", "vite.config.ts"]`. Leave the rest.

- [ ] **Step 3: Write the failing test `server/logo/parse.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { iconCandidates, isBlockedHost, normalizeUrl, parseTags, siteName } from './parse'

const page = new URL('https://www.example.com/home')

describe('normalizeUrl', () => {
  it('adds https:// to a bare domain', () => {
    expect(normalizeUrl(' example.com ')?.href).toBe('https://example.com/')
  })
  it('keeps http(s) URLs', () => {
    expect(normalizeUrl('http://example.com/a')?.href).toBe('http://example.com/a')
  })
  it('rejects other schemes, junk, dotless and private hosts', () => {
    for (const bad of ['', 'ftp://example.com', 'not a url', 'intranet', 'localhost:3000', '127.0.0.1', '192.168.1.5', 'http://10.0.0.1']) {
      expect(normalizeUrl(bad)).toBeNull()
    }
  })
})

describe('isBlockedHost', () => {
  it('blocks loopback, private, link-local and local names', () => {
    for (const h of ['localhost', 'a.localhost', 'printer.local', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.1.1', '0.0.0.0', '[::1]']) {
      expect(isBlockedHost(h)).toBe(true)
    }
  })
  it('allows public hosts', () => {
    for (const h of ['example.com', '8.8.8.8', '172.32.0.1']) expect(isBlockedHost(h)).toBe(false)
  })
})

describe('parseTags', () => {
  it('reads attributes with any quoting and decodes entities', () => {
    const html = `<link rel="icon" href='/a.png?x=1&amp;y=2' sizes=32x32><meta property="og:site_name" content="Ex">`
    expect(parseTags(html, 'link')).toEqual([{ rel: 'icon', href: '/a.png?x=1&y=2', sizes: '32x32' }])
    expect(parseTags(html, 'meta')).toEqual([{ property: 'og:site_name', content: 'Ex' }])
  })
})

describe('iconCandidates', () => {
  it('ranks apple-touch-icon, then SVG, then larger icons, then Google favicons; skips mask-icon', () => {
    const html = `<head>
      <link rel="icon" href="/16.png" sizes="16x16">
      <link rel="icon" href="/64.png" sizes="64x64">
      <link rel="mask-icon" href="/mask.svg">
      <link rel="icon" type="image/svg+xml" href="/logo.svg">
      <link rel="apple-touch-icon" href="https://cdn.example.com/touch.png" sizes="180x180">
    </head><body><link rel="icon" href="/ignored-body.png"></body>`
    expect(iconCandidates(html, page)).toEqual([
      'https://cdn.example.com/touch.png',
      'https://www.example.com/logo.svg',
      'https://www.example.com/64.png',
      'https://www.example.com/16.png',
      'https://www.google.com/s2/favicons?domain=www.example.com&sz=256',
    ])
  })
  it('falls back to Google favicons for empty HTML', () => {
    expect(iconCandidates('', page)).toEqual(['https://www.google.com/s2/favicons?domain=www.example.com&sz=256'])
  })
})

describe('siteName', () => {
  it('prefers og:site_name', () => {
    expect(siteName('<meta property="og:site_name" content="Example Co"><title>Home | Other</title>', page)).toBe('Example Co')
  })
  it('uses the first title segment', () => {
    expect(siteName('<title>Example &amp; Co — Build things</title>', page)).toBe('Example & Co')
  })
  it('falls back to the hostname without www', () => {
    expect(siteName('', page)).toBe('example.com')
  })
})
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run server/logo/parse.test.ts`
Expected: FAIL — vitest may first say no test files match because `vite.config.ts` only includes `src/**`. Do Step 9's vite config change for `test.include` now if so, then rerun: FAIL — cannot resolve `./parse`.

- [ ] **Step 5: Write `server/logo/parse.ts`**

```ts
export type Attrs = Record<string, string>

const TAG = /<(link|meta)\b([^>]*)>/gi
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

const decodeEntities = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** Everything before </head>, or the first 200k chars. */
const headOf = (html: string) => {
  const i = html.search(/<\/head>/i)
  return i === -1 ? html.slice(0, 200_000) : html.slice(0, i)
}

/** 'example.com' → https URL. Null for non-http(s), unparsable, dotless or private hosts. */
export function normalizeUrl(input: string): URL | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!url.hostname.includes('.') || isBlockedHost(url.hostname)) return null
  return url
}

/** Rough guard for a local demo: loopback, private, link-local and local names, by name or IPv4 literal. */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h.includes(':') || h.startsWith('[')) return true // IPv6 literals: block all
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

export function parseTags(html: string, name: 'link' | 'meta'): Attrs[] {
  const out: Attrs[] = []
  for (const m of html.matchAll(TAG)) {
    if (m[1].toLowerCase() !== name) continue
    const attrs: Attrs = {}
    for (const a of m[2].matchAll(ATTR)) attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '')
    out.push(attrs)
  }
  return out
}

const largestSize = (sizes: string | undefined) =>
  Math.max(0, ...(sizes ?? '').split(/\s+/).map((s) => parseInt(s, 10) || 0))

/** Absolute logo URLs, best first. Always ends with Google's favicon service. */
export function iconCandidates(html: string, page: URL): string[] {
  const ranked: { href: string; score: number }[] = []
  for (const link of parseTags(headOf(html), 'link')) {
    const rels = (link.rel ?? '').toLowerCase().split(/\s+/)
    if (!link.href || rels.includes('mask-icon')) continue
    if (rels.includes('apple-touch-icon') || rels.includes('apple-touch-icon-precomposed')) {
      ranked.push({ href: link.href, score: 3000 + largestSize(link.sizes) })
    } else if (rels.includes('icon')) {
      const svg = (link.type ?? '').includes('svg') || /\.svg(\?|$)/i.test(link.href)
      ranked.push({ href: link.href, score: svg ? 2500 : 1000 + largestSize(link.sizes) })
    }
  }
  ranked.sort((a, b) => b.score - a.score)
  const urls: string[] = []
  for (const { href } of ranked) {
    try {
      urls.push(new URL(href, page).href)
    } catch {
      // unparsable href: skip
    }
  }
  urls.push(`https://www.google.com/s2/favicons?domain=${page.hostname}&sz=256`)
  return [...new Set(urls)]
}

export function siteName(html: string, page: URL): string {
  const head = headOf(html)
  const og = parseTags(head, 'meta').find((m) => (m.property ?? '').toLowerCase() === 'og:site_name')?.content?.trim()
  if (og) return og
  const title = decodeEntities(head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '')
  const first = title.split(/\s[|\-–—:·]\s/)[0].trim()
  if (first && first.length <= 40) return first
  return page.hostname.replace(/^www\./, '')
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run server/logo/parse.test.ts`
Expected: all pass.

- [ ] **Step 7: Write the failing test `server/logo/handler.test.ts`**

```ts
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
```

- [ ] **Step 8: Write `server/logo/handler.ts`**

```ts
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
```

- [ ] **Step 9: Write `server/vite-plugin-logo.ts` and update `vite.config.ts`**

```ts
import type { Plugin } from 'vite'
import { handleLogo } from './logo/handler'

/** Serves /api/logo on the dev and preview servers. No API keys involved. */
export function logoApi(): Plugin {
  return {
    name: 'fuse-web-logo-api',
    configureServer(server) {
      server.middlewares.use('/api/logo', (req, res) => void handleLogo(req, res))
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/logo', (req, res) => void handleLogo(req, res))
    },
  }
}
```

`vite.config.ts`:
```ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { logoApi } from './server/vite-plugin-logo'

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url))

export default defineConfig({
  plugins: [logoApi()],
  build: {
    rollupOptions: {
      input: { main: page('./index.html'), fused: page('./fused.html') },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
})
```

`fused.html` doesn't exist until Task 4, so `npm run build` may fail until then — that's expected; don't create it here. (If Vite 8 rejects `rollupOptions`, use the option name its docs/types expect, e.g. `rolldownOptions`, and report it.)

- [ ] **Step 10: Verify**

Run: `npm run typecheck && npx vitest run server`
Expected: clean; all server tests pass.

Live check: `npm run dev` in the background, then:
```bash
curl -s 'localhost:5173/api/logo?url=github.com'; echo
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "localhost:5173$(curl -s 'localhost:5173/api/logo?url=github.com' | node -pe 'JSON.parse(require("fs").readFileSync(0)).logoUrl')"
curl -s 'localhost:5173/api/logo?url=localhost'; echo
```
Expected: JSON with `"id":"github.com"`; `200 image/...`; a 400 error JSON. Stop the server.

- [ ] **Step 11: Commit**

```bash
git add server vite.config.ts tsconfig.json package.json package-lock.json
git commit -m "feat: /api/logo dev-server route fetching a site's logo"
```

---

### Task 2: Scene — per-side shelves, your sites, card zones

**Files:**
- Modify: `src/config.ts`, `src/scene/layout.ts`, `src/scene/layout.test.ts`, `src/scene/Scene.ts`, `src/scene/Scene.test.ts`

- [ ] **Step 1: Config**

In `src/config.ts` `sceneConfig`, replace `dismissEdge` (and its comment) with:
```ts
  /** fraction of height at the top (open fused page) and bottom (dismiss) where a held card triggers */
  cardZone: 0.15,
```

- [ ] **Step 2: Update `src/scene/layout.test.ts` (failing)**

Change every `computeLayout(1000, 600, 6)` call to `computeLayout(1000, 600, { left: 6, right: 6 }, 6)`, then append:
```ts
  it('wraps a long shelf into a second, inner column', () => {
    const wide = computeLayout(1000, 600, { left: 1, right: 12 }, 6)
    expect(wide.shelf.left).toHaveLength(1)
    expect(wide.shelf.right).toHaveLength(12)
    expect(wide.shelf.right[5]).toEqual({ x: 952, y: (600 * 6) / 7 })
    expect(wide.shelf.right[6].x).toBe(880)
    expect(wide.shelf.right[6].y).toBeCloseTo(600 / 7)
  })
```

- [ ] **Step 3: Update `src/scene/layout.ts`**

```ts
import type { Point } from '../types'

export type Side = 'left' | 'right'

export interface Layout {
  width: number
  height: number
  shelfRadius: number
  slotRadius: number
  cardRadius: number
  shelf: Record<Side, Point[]>
  slots: [Point, Point]
  center: Point
}

/** Shelves fill top to bottom in columns of `rows`, outermost column first. */
export function computeLayout(width: number, height: number, counts: Record<Side, number>, rows: number): Layout {
  const short = Math.min(width, height)
  const shelfRadius = Math.round(short * 0.05)
  const slotRadius = Math.round(short * 0.12)
  const inset = Math.round(shelfRadius * 1.6)
  const colGap = Math.round(shelfRadius * 2.4)
  const place = (side: Side, count: number): Point[] =>
    Array.from({ length: count }, (_, i) => {
      const offset = inset + Math.floor(i / rows) * colGap
      return { x: side === 'left' ? offset : width - offset, y: (height * ((i % rows) + 1)) / (rows + 1) }
    })
  return {
    width,
    height,
    shelfRadius,
    slotRadius,
    cardRadius: Math.round(slotRadius * 1.5),
    shelf: { left: place('left', counts.left), right: place('right', counts.right) },
    slots: [
      { x: width * 0.3, y: height / 2 },
      { x: width * 0.7, y: height / 2 },
    ],
    center: { x: width / 2, y: height / 2 },
  }
}
```

Run: `npx vitest run src/scene/layout.test.ts` → 4 passed.

- [ ] **Step 4: Update `src/scene/Scene.test.ts` (tests first)**

1. In `setup()` and in the 4:3 test, replace `sites: SITES, perShelf: 6,` with `leftSites: SITES.slice(0, 6), rightSites: SITES.slice(6), rows: 6,` and add `onOpenFused` (a `vi.fn()`; return it from `setup()` as `onOpenFused`).
2. Replace the test "pulling a shelf logo onto a slot replaces it and sends the old one home" with:
```ts
  it('pulling a reference logo onto the right slot replaces it and sends the old one home', () => {
    const { scene, step } = setup()
    step([cur(1, 952, row(2), true)], [start(1, 952, row(2))])
    expect(scene.held.get(1)?.siteId).toBe('s8')
    step([cur(1, 700, 300, true)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    expect(scene.slots).toEqual(['s0', 's8'])
    expect(scene.flights).toContainEqual(expect.objectContaining({ siteId: 's6', to: { x: 952, y: row(0) } }))
    expect(scene.flights).toContainEqual(expect.objectContaining({ siteId: 's8', hideSlot: 1 }))
  })
```
3. Replace "refuses to put the same site in both slots" with:
```ts
  it('your logos only go in the left slot', () => {
    const { scene, step } = setup()
    step([cur(1, 48, row(2), true)], [start(1, 48, row(2))])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    expect(scene.slots).toEqual(['s0', 's6'])
    expect(scene.flights).toEqual([expect.objectContaining({ siteId: 's2', to: { x: 48, y: row(2) } })])
  })

  it('reference logos only go in the right slot', () => {
    const { scene, step } = setup()
    step([cur(1, 952, row(2), true)], [start(1, 952, row(2))])
    step([cur(1, 300, 300)], [end(1, 300, 300)])
    expect(scene.slots).toEqual(['s0', 's6'])
  })

  it('a left-shelf logo can replace the left slot', () => {
    const { scene, step } = setup()
    step([cur(1, 48, row(2), true)], [start(1, 48, row(2))])
    step([cur(1, 300, 300)], [end(1, 300, 300)])
    expect(scene.slots).toEqual(['s2', 's6'])
  })
```
4. Replace "the card glides to center, shows the result, and is dismissed at an edge" with:
```ts
  it('the card glides to center and is dismissed by pulling it into the bottom zone, without releasing', () => {
    const { scene, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    step([])
    expect(scene.fuse?.at).toEqual({ x: 500, y: 300 })
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 500, 400, true)])
    expect(scene.fuse).not.toBeNull()
    step([cur(1, 500, 580, true)])
    expect(scene.fuse).toBeNull()
    expect(scene.held.size).toBe(0)
    step([cur(1, 500, 580)], [end(1, 500, 580)])
    expect(scene.slots).toEqual(['s0', 's6'])
  })

  it('left and right edges no longer dismiss', () => {
    const { scene, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 30, 300, true)])
    step([cur(1, 30, 300)], [end(1, 30, 300)])
    expect(scene.fuse).not.toBeNull()
  })

  it('pulling a finished card into the top zone opens it once and lets it go', () => {
    const { scene, onOpenFused, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    scene.setFuseResult(scene.fuse!.id, { siteA: 's0', siteB: 's6', label: 'Site 0 × Site 6' })
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 500, 40, true)])
    expect(onOpenFused).toHaveBeenCalledTimes(1)
    expect(onOpenFused.mock.calls[0].map((s: Site) => s.id)).toEqual(['s0', 's6'])
    expect(scene.held.size).toBe(0)
    step([cur(1, 500, 40, true)])
    expect(onOpenFused).toHaveBeenCalledTimes(1)
    expect(scene.fuse?.at).toEqual({ x: 500, y: 300 })
  })

  it('the top zone does nothing while still fusing', () => {
    const { scene, onOpenFused, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 500, 40, true)])
    expect(onOpenFused).not.toHaveBeenCalled()
    expect(scene.held.size).toBe(1)
  })
```
5. In "ignores a stale result from a dismissed fuse of the same pair", the dismissal currently drags the card to `x=50` and releases. Change those two lines to pull it into the bottom zone instead:
```ts
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 500, 580, true)])
    step([cur(1, 500, 580)], [end(1, 500, 580)])
```
Check for any other test that dismisses via a left/right edge and convert it the same way.
6. Append a new `describe('Scene: your sites', …)`:
```ts
describe('Scene: your sites', () => {
  const site = (id: string): Site => ({ id, name: id, url: `https://${id}`, color: '#123456', logoUrl: `/x/${id}` })

  it('adds a site to the front of the left shelf and into the left slot', () => {
    const { scene } = setup()
    scene.addLeftSite(site('mine.com'))
    expect(scene.shelves.left).toEqual(['mine.com', 's0', 's1', 's2', 's3', 's4'])
    expect(scene.slots[0]).toBe('mine.com')
    expect(scene.site('mine.com').name).toBe('mine.com')
    expect(scene.layout.shelf.left).toHaveLength(6)
  })

  it('re-adding an existing site moves it to the front', () => {
    const { scene } = setup()
    scene.addLeftSite(SITES[3])
    expect(scene.shelves.left).toEqual(['s3', 's0', 's1', 's2', 's4', 's5'])
    expect(scene.slots[0]).toBe('s3')
  })

  it('does not swap the left slot while it is held', () => {
    const { scene, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    scene.addLeftSite(site('mine.com'))
    expect(scene.slots[0]).toBe('s0')
    expect(scene.shelves.left).toContain('s0')
  })

  it('starts with one site on the left and lays 12 reference sites in two columns', () => {
    const scene = new Scene({
      leftSites: [site('mine.com')],
      rightSites: SITES,
      rows: 6,
      width: 1000,
      height: 600,
      onFuse: vi.fn(),
      onOpenFused: vi.fn(),
    })
    expect(scene.slots).toEqual(['mine.com', 's0'])
    expect(scene.layout.shelf.left).toHaveLength(1)
    expect(scene.layout.shelf.right[6].x).toBe(880)
  })
})
```

Run: `npx vitest run src/scene` → FAIL (type errors / new behavior missing).

- [ ] **Step 5: Update `src/scene/Scene.ts`**

Apply these changes (keep everything else as is):

a. Options:
```ts
export interface SceneOptions {
  /** the user's sites, newest first; the first fills the left slot */
  leftSites: Site[]
  /** reference sites; the first fills the right slot */
  rightSites: Site[]
  /** logos per shelf column; also the max number of the user's sites kept */
  rows: number
  width: number
  height: number
  onFuse: (a: Site, b: Site, fuseId: number) => void
  /** a finished card was pulled into the top zone */
  onOpenFused: (a: Site, b: Site) => void
  config?: SceneConfig
}

/** each shelf feeds one center slot: your sites → left, reference sites → right */
const SLOT_OF: Record<Side, 0 | 1> = { left: 0, right: 1 }
```

b. Fields and constructor (replace `perShelf` with `rows`, `width`, `height`; `sitesById` becomes a mutable map; add `onOpenFused`):
```ts
  private readonly sitesById = new Map<string, Site>()
  private readonly config: SceneConfig
  private readonly onFuse: (a: Site, b: Site, fuseId: number) => void
  private readonly onOpenFused: (a: Site, b: Site) => void
  private readonly rows: number
  private width: number
  private height: number
  private nextFuseId = 1

  constructor(opts: SceneOptions) {
    if (!opts.leftSites.length || !opts.rightSites.length) throw new Error('need at least one site on each side')
    this.config = opts.config ?? defaultConfig
    this.rows = opts.rows
    this.onFuse = opts.onFuse
    this.onOpenFused = opts.onOpenFused
    for (const s of [...opts.leftSites, ...opts.rightSites]) this.sitesById.set(s.id, s)
    this.shelves = { left: opts.leftSites.slice(0, opts.rows).map((s) => s.id), right: opts.rightSites.map((s) => s.id) }
    this.slots = [this.shelves.left[0], this.shelves.right[0]]
    this.width = opts.width
    this.height = opts.height
    this.layout = this.relayout()
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
    this.layout = this.relayout()
  }

  /** Adds one of the user's sites (or moves it) to the front of the left shelf and into the left slot. */
  addLeftSite(site: Site): void {
    this.sitesById.set(site.id, site)
    const left = [site.id, ...this.shelves.left.filter((id) => id !== site.id)]
    if (!this.isSlotHeld(0)) this.slots[0] = site.id
    // keep at most `rows`, never dropping the site that's in the left slot
    for (let i = left.length - 1; left.length > this.rows && i >= 0; i--) {
      if (left[i] !== this.slots[0]) left.splice(i, 1)
    }
    this.shelves.left.splice(0, this.shelves.left.length, ...left)
    this.layout = this.relayout()
  }

  /** y thresholds: above `top` opens the fused page, below `bottom` dismisses the card */
  cardZones(): { top: number; bottom: number } {
    const z = this.config.cardZone * this.layout.height
    return { top: z, bottom: this.layout.height - z }
  }

  isCardHeld(): boolean {
    return this.cardHold() !== undefined
  }

  private relayout(): Layout {
    return computeLayout(this.width, this.height, { left: this.shelves.left.length, right: this.shelves.right.length }, this.rows)
  }
```

c. In `update`, replace the `if (this.fuse) { … }` block with:
```ts
    const card = this.fuse ? this.cardHold() : undefined
    if (this.fuse) this.fuse.at = card ? { ...card.pos } : lerp(this.fuse.at, this.layout.center, k)
    if (card) this.checkCardZones(card)
```
and add:
```ts
  private checkCardZones(card: Held): void {
    const f = this.fuse
    if (!f) return
    const { top, bottom } = this.cardZones()
    if (card.target.y > bottom) {
      this.held.delete(card.handId)
      this.fuse = null
    } else if (card.target.y < top && f.status === 'done') {
      // let go so it glides back; the hand must release and grip again to re-open
      this.held.delete(card.handId)
      this.onOpenFused(this.site(f.siteA), this.site(f.siteB))
    }
  }
```

d. In `gripEnd`, replace the `if (h.from.kind === 'shelf') { … }` block with:
```ts
    if (h.from.kind === 'shelf') {
      const slot = SLOT_OF[h.from.side]
      if (target === slot && !this.isSlotHeld(slot)) {
        const replaced = this.slots[slot]
        if (replaced !== siteId) this.fly(replaced, L.slots[slot], this.shelfPosOf(replaced), L.slotRadius, L.shelfRadius)
        this.slots[slot] = siteId
        this.fly(siteId, h.pos, L.slots[slot], r, L.slotRadius, slot)
      } else {
        this.fly(siteId, h.pos, this.itemPos(h.from), r, L.shelfRadius)
      }
      return
    }
```

e. Replace `dropCard(p: Point)` with a no-argument version (only the error retry remains) and update its call site to `this.dropCard()`:
```ts
  private dropCard(): void {
    const f = this.fuse
    if (f?.status !== 'error') return
    f.status = 'fusing'
    f.startedAt = this.now
    f.id = this.nextFuseId++
    this.onFuse(this.site(f.siteA), this.site(f.siteB), f.id)
  }
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/scene && npm run typecheck`
Expected: scene tests pass. `npm run typecheck` will fail in `src/main.ts`, `src/data/sites.ts` and `src/render/*` (old `sites/perShelf` options, `iconPath` now optional, `dismissEdge` gone) — those are fixed in Tasks 3–4. Only scene/config/layout files must be clean; confirm with `npx tsc --noEmit 2>&1 | grep -v -E 'src/(main|data|render|ui|sites|fused)'` showing no errors.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/scene
git commit -m "feat: your sites vs reference shelves, side-locked slots, card open/dismiss zones"
```

---

### Task 3: Sites, colors and rendering

**Files:**
- Modify: `src/types.ts`, `src/data/sites.ts`, `src/data/sites.test.ts`, `src/render/logoImages.ts`, `src/render/logoImages.test.ts`, `src/render/Renderer.ts`
- Create: `src/sites/dominantColor.ts`, `src/sites/dominantColor.test.ts`

- [ ] **Step 1: `src/types.ts` — `Site`**

```ts
export interface Site {
  id: string
  name: string
  url: string
  /** brand color as #RRGGBB */
  color: string
  /** reference sites: SVG path data in a 24×24 viewBox (simple-icons) */
  iconPath?: string
  /** your sites: same-origin logo image URL from /api/logo */
  logoUrl?: string
}
```

- [ ] **Step 2: `src/data/sites.ts`**

Rename `PER_SHELF` → `SHELF_ROWS = 6` and `SITES` → `REFERENCE_SITES` (same 12 sites, same order). Update the doc comment: "Reference sites for the right shelf (2 columns of SHELF_ROWS). The right slot starts with the first." Update `src/data/sites.test.ts` to the new names (`expect(REFERENCE_SITES).toHaveLength(SHELF_ROWS * 2)`).

- [ ] **Step 3: Failing test `src/sites/dominantColor.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { dominantColor } from './dominantColor'

const px = (...colors: [number, number, number, number][]) => new Uint8ClampedArray(colors.flat())

describe('dominantColor', () => {
  it('returns a solid color', () => {
    expect(dominantColor(px([255, 0, 0, 255], [255, 0, 0, 255]))).toBe('#ff0000')
  })
  it('ignores transparent and near-white pixels', () => {
    expect(dominantColor(px([0, 0, 255, 255], [0, 255, 0, 0], [250, 250, 250, 255]))).toBe('#0000ff')
  })
  it('weights saturated pixels over grey ones', () => {
    const c = dominantColor(px([255, 0, 0, 255], [128, 128, 128, 255], [128, 128, 128, 255]))
    expect(parseInt(c.slice(1, 3), 16)).toBeGreaterThan(200)
  })
  it('returns near-black for an all-black logo', () => {
    expect(dominantColor(px([0, 0, 0, 255], [5, 5, 5, 255]))).toBe('#111111')
  })
  it('returns the fallback when nothing is usable', () => {
    expect(dominantColor(px([0, 0, 0, 0]))).toBe('#888888')
    expect(dominantColor(px([255, 255, 255, 255]), '#123456')).toBe('#123456')
  })
})
```

Run: `npx vitest run src/sites` → FAIL (cannot resolve).

- [ ] **Step 4: `src/sites/dominantColor.ts`**

```ts
/**
 * A logo's brand color from RGBA pixels: saturation-weighted average of opaque pixels,
 * ignoring near-white (backgrounds) and near-black. All-black logos → #111111.
 */
export function dominantColor(rgba: Uint8ClampedArray, fallback = '#888888'): string {
  let r = 0
  let g = 0
  let b = 0
  let weight = 0
  let dark = 0
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue
    const [R, G, B] = [rgba[i], rgba[i + 1], rgba[i + 2]]
    const max = Math.max(R, G, B)
    const min = Math.min(R, G, B)
    if (min > 235) continue
    if (max < 24) {
      dark++
      continue
    }
    const w = max - min + 8
    r += R * w
    g += G * w
    b += B * w
    weight += w
  }
  if (!weight) return dark ? '#111111' : fallback
  const hex = (v: number) => Math.round(v / weight).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}
```

Run: `npx vitest run src/sites` → pass.

- [ ] **Step 5: `src/render/logoImages.ts` (+ tests)**

Append to `src/render/logoImages.test.ts`:
```ts
import { logoSrc } from './logoImages'

describe('logoSrc', () => {
  it('uses the fetched logo for your sites', () => {
    expect(logoSrc({ id: 'a', name: 'A', url: '', color: '#000000', logoUrl: '/api/logo/img?id=a' })).toBe('/api/logo/img?id=a')
  })
  it('builds an SVG data URL for reference sites', () => {
    expect(logoSrc({ id: 'b', name: 'B', url: '', color: '#000000', iconPath: 'M0 0h24v24H0z' })).toMatch(/^data:image\/svg\+xml/)
  })
})
```
(Merge the import into the existing import line.)

Replace `glyphImage` in `src/render/logoImages.ts` with:
```ts
/** Image source for a site's logo: the fetched logo, or the simple-icons glyph as an SVG data URL. */
export function logoSrc(site: Site): string {
  if (site.logoUrl) return site.logoUrl
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="${glyphColor(site.color)}" d="${site.iconPath ?? ''}"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** The site's logo as an <img>, ready for canvas drawImage once loaded. */
export function logoImage(site: Site): HTMLImageElement {
  const img = new Image()
  img.src = logoSrc(site)
  return img
}
```

- [ ] **Step 6: `src/render/Renderer.ts`**

a. Import `logoImage` instead of `glyphImage`; constructor uses `logoImage(s)`; add:
```ts
  /** Registers a site added at runtime (your sites). */
  addSite(site: Site): void {
    this.glyphs.set(site.id, logoImage(site))
  }
```

b. Replace `drawLogo` with:
```ts
  private drawLogo(site: Site, p: Point, r: number, glow = false, alpha = 1): void {
    const { ctx } = this
    const img = this.glyphs.get(site.id)
    const ready = img !== undefined && img.complete && img.naturalWidth > 0
    ctx.save()
    ctx.globalAlpha = alpha
    if (glow) {
      ctx.shadowColor = 'rgba(255, 255, 255, 0.9)'
      ctx.shadowBlur = r * 0.8
    }
    // your sites: full-color logo on white; reference sites: white/black glyph on brand color
    ctx.fillStyle = site.logoUrl ? '#ffffff' : site.color
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    if (ready) {
      const box = site.logoUrl ? r * 1.3 : r * 1.1
      const k = box / Math.max(img.naturalWidth, img.naturalHeight)
      const w = img.naturalWidth * k
      const h = img.naturalHeight * k
      ctx.clip()
      ctx.drawImage(img, p.x - w / 2, p.y - h / 2, w, h)
    }
    ctx.restore()
  }
```

c. Add zone hints and call it in `draw` right before `this.drawFuse(scene)`:
```ts
  private drawCardZones(scene: Scene): void {
    if (!scene.fuse || !scene.isCardHeld()) return
    const { ctx } = this
    const { width: W, height: H } = scene.layout
    const { top, bottom } = scene.cardZones()
    const canOpen = scene.fuse.status === 'done'
    ctx.save()
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
    if (canOpen) ctx.fillRect(0, 0, W, top)
    ctx.fillRect(0, bottom, W, H - bottom)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.font = '600 18px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (canOpen) ctx.fillText('↑ open fused site', W / 2, top / 2)
    ctx.fillText('↓ dismiss', W / 2, bottom + (H - bottom) / 2)
    ctx.restore()
  }
```

d. In `drawFuse`, change the status text to:
```ts
    const status =
      f.status === 'fusing'
        ? 'fusing…'
        : f.status === 'error'
          ? 'failed — grip to retry · pull ↓ to dismiss'
          : 'pull ↑ to open · pull ↓ to dismiss'
```

- [ ] **Step 7: Verify and commit**

Run: `npx vitest run src/sites src/render src/data src/scene`
Expected: all pass. (`npm run typecheck` still fails only in `src/main.ts` until Task 4.)

```bash
git add src/types.ts src/data src/sites src/render
git commit -m "feat: reference/your-site logos, dominant color, card zone hints"
```

---

### Task 4: Start page, + site, fused page, wiring

**Files:**
- Create: `src/sites/userSite.ts`, `src/ui/siteForm.ts`, `src/ui/fusedPair.ts`, `src/ui/fusedPair.test.ts`, `src/ui/fusedView.ts`, `fused.html`, `src/fused.ts`, `src/fused.css`
- Modify: `index.html`, `src/style.css`, `src/main.ts`, `src/debug/DebugPanel.ts`, `README.md`

- [ ] **Step 1: Failing test `src/ui/fusedPair.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import type { Site } from '../types'
import { readFusedPair, saveFusedPair } from './fusedPair'

const a: Site = { id: 'mine.com', name: 'Mine', url: 'https://mine.com/', color: '#123456', logoUrl: '/api/logo/img?id=mine.com' }
const b: Site = { id: 'spotify', name: 'Spotify', url: 'https://www.spotify.com', color: '#1ED760', iconPath: 'M0 0' }

function memoryStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('fusedPair', () => {
  it('round-trips a pair under its id', () => {
    const s = memoryStorage()
    const id = saveFusedPair(a, b, s)
    expect(id).toBe('mine.com__spotify')
    expect(readFusedPair(id, s)).toEqual([a, b])
  })
  it('returns null for unknown or corrupt entries', () => {
    const s = memoryStorage()
    expect(readFusedPair('x__y', s)).toBeNull()
    s.setItem('fuse-web:pair:bad', '{')
    expect(readFusedPair('bad', s)).toBeNull()
  })
})
```

- [ ] **Step 2: `src/ui/fusedPair.ts`**

```ts
import type { Site } from '../types'

const KEY = 'fuse-web:pair:'

type Reader = Pick<Storage, 'getItem'>
type Writer = Pick<Storage, 'setItem'>

/** Stores the pair for the fused page (a new tab shares localStorage) and returns its id. */
export function saveFusedPair(a: Site, b: Site, storage: Writer = localStorage): string {
  const id = `${a.id}__${b.id}`
  try {
    storage.setItem(KEY + id, JSON.stringify([a, b]))
  } catch {
    // storage blocked or full: the fused page shows its fallback
  }
  return id
}

export function readFusedPair(id: string, storage: Reader = localStorage): [Site, Site] | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(KEY + id) ?? 'null')
    return Array.isArray(value) && value.length === 2 ? (value as [Site, Site]) : null
  } catch {
    return null
  }
}
```

Run: `npx vitest run src/ui` → pass.

- [ ] **Step 3: `src/sites/userSite.ts`**

```ts
import type { Site } from '../types'
import { dominantColor } from './dominantColor'

interface LogoInfo {
  id: string
  name: string
  url: string
  logoUrl: string
}

/** Asks the dev server for a site's logo, then samples its brand color. */
export async function fetchUserSite(input: string): Promise<Site> {
  const res = await fetch(`/api/logo?url=${encodeURIComponent(input)}`)
  const body = (await res.json().catch(() => ({}))) as Partial<LogoInfo> & { error?: string }
  if (!res.ok || !body.logoUrl || !body.id) throw new Error(body.error ?? `Logo lookup failed (HTTP ${res.status})`)
  const img = await loadImage(body.logoUrl)
  return { id: body.id, name: body.name ?? body.id, url: body.url ?? input, logoUrl: body.logoUrl, color: sampleColor(img) }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('The logo image could not be loaded'))
    img.src = src
  })
}

function sampleColor(img: HTMLImageElement): string {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 32
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return '#888888'
  ctx.drawImage(img, 0, 0, 32, 32)
  try {
    return dominantColor(ctx.getImageData(0, 0, 32, 32).data)
  } catch {
    return '#888888'
  }
}
```

- [ ] **Step 4: `src/ui/siteForm.ts`**

```ts
import { fetchUserSite } from '../sites/userSite'
import type { Site } from '../types'

/** A form with one text input: on submit, fetches that site's logo and hands back a Site. */
export function bindSiteForm(form: HTMLFormElement, status: HTMLElement, onSite: (site: Site) => void): void {
  const input = form.querySelector('input')
  if (!input) throw new Error('site form needs an <input>')
  const button = form.querySelector('button')
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const value = input.value.trim()
    if (!value) return
    status.textContent = 'Fetching logo…'
    input.disabled = true
    if (button) button.disabled = true
    try {
      const site = await fetchUserSite(value)
      status.textContent = ''
      input.value = ''
      onSite(site)
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err)
    } finally {
      input.disabled = false
      if (button) button.disabled = false
    }
  })
}
```

- [ ] **Step 5: `src/ui/fusedView.ts`**

```ts
import type { Site } from '../types'
import { saveFusedPair } from './fusedPair'

/**
 * Opens the fused page in a new tab. A hand gesture isn't a user activation, so Chrome may
 * block the pop-up — then the page shows in the in-app overlay instead.
 */
export function openFused(a: Site, b: Site, overlay: HTMLElement, onBlocked: () => void): void {
  const url = `/fused.html?pair=${encodeURIComponent(saveFusedPair(a, b))}`
  if (window.open(url, '_blank')) return
  const frame = overlay.querySelector('iframe')
  if (frame) frame.src = url
  overlay.hidden = false
  onBlocked()
}

export function bindOverlayClose(overlay: HTMLElement): void {
  const close = () => {
    overlay.hidden = true
    const frame = overlay.querySelector('iframe')
    if (frame) frame.src = 'about:blank'
  }
  overlay.querySelector('button')?.addEventListener('click', close)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) close()
  })
}
```

- [ ] **Step 6: Fused page — `fused.html`, `src/fused.ts`, `src/fused.css`**

`fused.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Fused site</title>
  </head>
  <body>
    <main id="fused"></main>
    <script type="module" src="/src/fused.ts"></script>
  </body>
</html>
```

`src/fused.ts`:
```ts
import './fused.css'
import { logoSrc } from './render/logoImages'
import { readFusedPair } from './ui/fusedPair'

const root = document.querySelector<HTMLElement>('#fused')!
const pair = readFusedPair(new URLSearchParams(location.search).get('pair') ?? '')

if (!pair) {
  root.textContent = 'Nothing fused yet — go back and fuse two sites.'
} else {
  const [a, b] = pair
  document.title = `${a.name} × ${b.name}`
  document.documentElement.style.setProperty('--a', a.color)
  document.documentElement.style.setProperty('--b', b.color)

  const marks = document.createElement('div')
  marks.className = 'marks'
  for (const site of pair) {
    const img = document.createElement('img')
    img.alt = site.name
    img.src = logoSrc(site)
    if (site.logoUrl) img.className = 'own'
    marks.append(img)
  }
  const title = document.createElement('h1')
  title.textContent = `${a.name} × ${b.name}`
  const note = document.createElement('p')
  note.textContent = 'The fused site is coming soon.'
  root.append(marks, title, note)
}
```

`src/fused.css`:
```css
html, body { margin: 0; height: 100%; }
body {
  display: grid;
  place-items: center;
  font-family: system-ui, -apple-system, sans-serif;
  color: #fff;
  background: linear-gradient(100deg, var(--a, #333) 0 50%, var(--b, #555) 50% 100%);
}
#fused { text-align: center; padding: 24px; text-shadow: 0 2px 12px rgba(0, 0, 0, 0.35); }
.marks { display: flex; justify-content: center; gap: 24px; }
.marks img {
  width: 96px;
  height: 96px;
  padding: 18px;
  border-radius: 50%;
  object-fit: contain;
  background: rgba(0, 0, 0, 0.25);
}
.marks img.own { background: #fff; }
h1 { font-size: clamp(32px, 6vw, 64px); margin: 24px 0 8px; }
p { opacity: 0.85; }
```

- [ ] **Step 7: `index.html`** — add inside `<body>` before the `<script>`:

```html
    <section id="start">
      <h1>fuse-web</h1>
      <p>Enter your site. We'll grab its logo so you can fuse it with famous sites — with your hands.</p>
      <form id="start-form" autocomplete="off">
        <input name="site" placeholder="yoursite.com" spellcheck="false" autofocus />
        <button type="submit">Start</button>
      </form>
      <p id="start-status" class="status"></p>
    </section>
    <form id="add-site" autocomplete="off" hidden>
      <input name="site" placeholder="+ add your site" spellcheck="false" />
      <span id="add-status" class="status"></span>
    </form>
    <div id="fused-overlay" hidden>
      <iframe title="Fused site"></iframe>
      <button type="button" aria-label="Close">×</button>
    </div>
```

- [ ] **Step 8: `src/style.css`** — append:

```css
#start {
  position: fixed;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  padding: 16px;
  text-align: center;
  background: #0b0b10;
  z-index: 10;
}
#start h1 { margin: 0; font-size: 44px; letter-spacing: -0.02em; }
#start p { margin: 0 0 12px; max-width: 420px; color: rgba(255, 255, 255, 0.7); }
#start-form { display: flex; gap: 8px; }
#start-form input, #add-site input {
  font: inherit;
  color: inherit;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 10px;
  padding: 10px 14px;
  outline: none;
}
#start-form input { width: min(320px, 70vw); font-size: 18px; }
#start-form input:focus, #add-site input:focus { border-color: rgba(255, 255, 255, 0.6); }
#start-form button {
  font: inherit;
  font-weight: 600;
  padding: 10px 18px;
  border: 0;
  border-radius: 10px;
  background: #fff;
  color: #0b0b10;
  cursor: pointer;
}
#start-form button:disabled { opacity: 0.5; cursor: default; }
.status { min-height: 1.4em; font-size: 14px; color: rgba(255, 255, 255, 0.7); }

#add-site {
  position: fixed;
  top: 12px;
  left: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 5;
}
#add-site input { width: 180px; font-size: 14px; padding: 6px 10px; }

#fused-overlay { position: fixed; inset: 0; z-index: 20; background: #000; }
#fused-overlay iframe { width: 100%; height: 100%; border: 0; }
#fused-overlay button {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  font-size: 22px;
  line-height: 1;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  cursor: pointer;
}
```

If `#debug` overlaps `#add-site` at top-left, move `#debug` to `top: 56px`.

- [ ] **Step 9: `src/debug/DebugPanel.ts`** — in the keydown listener, before the modifier check add:

```ts
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
```

- [ ] **Step 10: `src/main.ts`** — restructure around the start page

Keep the existing camera, frame-loop, resize and banner logic, with these changes:
- Imports: `REFERENCE_SITES, SHELF_ROWS` from `./data/sites`; `bindSiteForm` from `./ui/siteForm`; `openFused, bindOverlayClose` from `./ui/fusedView`; `type Site` from `./types`.
- `const renderer = new Renderer(canvas, REFERENCE_SITES)` stays at module level; `engine`, `mouse`, `debug` too.
- `let scene: Scene | null = null`. Do **not** create the Scene or start the camera at load.
- `resize()` calls `scene?.resize(...)`.
- Start form: `bindSiteForm(startForm, startStatus, (site) => startStage(site))`.
- `+ site` form: `bindSiteForm(addForm, addStatus, (site) => { renderer.addSite(site); scene?.addLeftSite(site) })`.
- `bindOverlayClose(overlay)`.
- `startStage(site)`:
```ts
function startStage(site: Site) {
  start.hidden = true
  addForm.hidden = false
  renderer.addSite(site)
  scene = new Scene({
    leftSites: [site],
    rightSites: REFERENCE_SITES,
    rows: SHELF_ROWS,
    width: innerWidth,
    height: innerHeight,
    onFuse: (a, b, fuseId) => {
      fuseClient.fuse(a, b).then(
        (result) => scene?.setFuseResult(fuseId, result),
        (err) => {
          console.error('fuse failed', err)
          scene?.setFuseError(fuseId)
        },
      )
    },
    onOpenFused: (a, b) =>
      openFused(a, b, overlay, () =>
        showBanner('Pop-up blocked — showing it here. Allow pop-ups for this site to open fused pages in a new tab.', 6000),
      ),
  })
  void startCamera()
}
```
- `showBanner(text: string, hideAfterMs?: number)`: when `hideAfterMs` is given, hide the banner again after that delay (clear any previous timer).
- In `frame()`, after `requestAnimationFrame(frame)`, `if (!scene) return` inside the try (nothing to draw before the stage starts).
- The hint logic is unchanged.

- [ ] **Step 11: README** — update "Controls"/intro:
  - Start page: enter your site; its logo is fetched by the dev server (`/api/logo`) and appears on the left. `+ add your site` (top-left) adds more.
  - Right side: 12 reference sites. Your logos go in the left slot, reference logos in the right.
  - Result card: pull **up** to open the fused page (new tab; if pop-ups are blocked it opens in-app — allow pop-ups for the site to get tabs), pull **down** to dismiss.
  - Note: `/api/logo` fetches public pages from your machine; it only runs in `npm run dev` / `npm run preview`.

- [ ] **Step 12: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass; `dist/` contains `index.html` and `fused.html`.

Live (no camera needed): `npm run dev` in the background, then:
```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:5173/fused.html
curl -s 'localhost:5173/api/logo?url=stripe.com'; echo
```
Expected: `200`; JSON with a `logoUrl`. Stop the server. The camera/gesture checks are for the human.

Pre-push safety:
```bash
git grep -n -I -E 'AIza|sk-[A-Za-z0-9]|api[_-]?key\s*[:=]|-----BEGIN|@hotmail|@gmail|/Users/' -- . ':!package-lock.json' ':!docs/' || echo "clean"
```
Expected: `clean`.

- [ ] **Step 13: Commit**

```bash
git add index.html fused.html src README.md
git commit -m "feat: start page, add-your-site box, fused page with overlay fallback"
```
