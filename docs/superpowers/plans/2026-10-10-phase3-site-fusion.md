# Phase 3 — Site Fusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the moment two logos start fusing, the dev server captures both sites (headless Chromium) and has Gemini (`gemini-3.8-flash`) write one fused landing page — left site's content in the right site's style — so pulling the card up just opens it.

**Architecture:** New server modules under `server/site/`: a Playwright capturer running one plain-JS `inspectPage` script (cached per host), a pure prompt builder, a Gemini `generateContent` page generator, and a small job registry exposed at `/api/fuse-site` (start/status/page/cancel). The browser starts the job in `onFuse`, cancels it on dismiss, shows its status on the card, and `fused.html` polls and then shows the page.

**Tech Stack:** existing + `playwright` (devDependency; Chromium). Gemini REST API (`generateContent`) via `fetch`. No other new deps.

**Spec:** `docs/superpowers/specs/2026-10-10-fuse-web-design.md` → "Phase 3 — fused landing page".

**Testing (owner preference):** lightweight — only the few high-level tests listed. Visuals are checked live.

**Secrets rules (critical — public repo):** `OPENAI_API_KEY` (logo) and `GEMINI_API_KEY` (page) are read only from server env (`fuseOptionsFrom`). Never print/log/write them; send the Gemini key only in the `x-goog-api-key` header (never in a URL — URLs end up in logs); never put keys in tests (use `'test-key'`); no real API calls except Task 4's single live run by the controller. Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push. Never kill processes you didn't start; own dev server = `npx vite --port 5299 --strictPort`, stop by PID.

---

## Files

```
server/pair.ts                 pairId(aId, bId) — shared by fuse-logo and fuse-site
server/fuse/handler.ts         import pairId from ../pair (no behavior change)
server/fuse/options.ts         + geminiApiKey, pageModel, pageThinking, maxPages
server/site/types.ts           SiteCapture
server/site/inspectPage.ts     INSPECT_PAGE_JS (plain JS string run in the page)
server/site/capture.ts         createCapturer(cacheDir) — Playwright, cache, dedupe
server/site/capture.test.ts    one test: inspect a local fixture via setContent
server/site/prompt.ts          buildPagePrompt(...) (pure)
server/site/generate.ts        generatePage(...) — Gemini generateContent, extractHtml
server/site/generate.test.ts   extractHtml + request shape (stubbed fetch)
server/site/jobs.ts            createSiteJobs(...) start/status/cancel
server/site/handler.ts         routes for /api/fuse-site
server/vite-plugin-site.ts     mounts /api/fuse-site
vite.config.ts                 + siteApi(...)
src/fuse/siteJobs.ts           startSite / siteStatus / cancelSite (browser)
src/scene/Scene.ts             FuseState.pageStatus + setPageStatus(fuseId, status)
src/render/Renderer.ts         status line shows page status
src/ui/fusedPair.ts            store pageId
src/main.ts                    start/poll/cancel site job alongside the logo fuse
src/fused.ts, src/fused.css    building animation → switch to the page
.env.example, README.md
```

---

### Task 1: Capture (Playwright + inspectPage)

- [ ] **Step 1: Install Playwright**

`npm install -D playwright` then `npx playwright install chromium` (one-time browser download outside the repo; skip if already present for this Playwright version). Add to README "Run": "Site fusion needs Chromium for Playwright: `npx playwright install chromium` (one time)."

- [ ] **Step 2: `server/site/types.ts`**

```ts
export interface SiteTokens {
  background: string
  text: string
  accent: string
  headingFont: string
  bodyFont: string
  h1Size: string
  radius: string
  shadow: string
  button: { background: string; color: string; radius: string; padding: string; fontWeight: string }
}

export interface SiteContent {
  title: string
  headline: string
  subhead: string
  ctas: string[]
  nav: string[]
  sections: { heading: string; text: string }[]
}

export interface SiteCapture {
  url: string
  tokens: SiteTokens
  content: SiteContent
  /** absolute URLs, largest first */
  images: string[]
  logo?: string
}
```

- [ ] **Step 3: `server/site/inspectPage.ts`**

Kept as a plain-JS string so bundlers can't inject helpers into code that runs inside the page.

```ts
/** Runs inside the captured page via page.evaluate. Returns SiteCapture minus `url`. Plain JS on purpose. */
export const INSPECT_PAGE_JS = String.raw`(() => {
  const clean = (s, max) => (s || '').replace(/\s+/g, ' ').trim().slice(0, max || 200)
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 4 && r.height > 4 && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05
  }
  const all = (sel) => Array.from(document.querySelectorAll(sel)).filter(visible)
  const first = (sel) => all(sel)[0] || null
  const style = (el) => (el ? getComputedStyle(el) : null)
  const solid = (c) => c && c !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(c)
  const abs = (u) => { try { return new URL(u, location.href).href } catch { return '' } }

  const bgCandidates = [document.body, document.documentElement, first('main'), first('header'), first('section')]
  let background = 'rgb(255, 255, 255)'
  for (const el of bgCandidates) { const c = el && getComputedStyle(el).backgroundColor; if (solid(c)) { background = c; break } }

  const h1 = first('h1')
  const h1s = style(h1)
  const bodyS = getComputedStyle(document.body)
  const button =
    first('a[class*="btn" i], a[class*="button" i], button[class*="primary" i], a[class*="cta" i]') ||
    first('button, [role="button"]')
  const bs = style(button)
  const accent = bs && solid(bs.backgroundColor) ? bs.backgroundColor : (style(first('a')) || bodyS).color
  const card = first('[class*="card" i], article, li[class*="item" i]')

  const tokens = {
    background,
    text: bodyS.color,
    accent,
    headingFont: (h1s || bodyS).fontFamily,
    bodyFont: bodyS.fontFamily,
    h1Size: h1s ? h1s.fontSize : '48px',
    radius: (style(card) || bs || bodyS).borderRadius || '0px',
    shadow: (style(card) || bodyS).boxShadow || 'none',
    button: bs
      ? { background: bs.backgroundColor, color: bs.color, radius: bs.borderRadius, padding: bs.padding, fontWeight: bs.fontWeight }
      : { background: accent, color: '#ffffff', radius: '8px', padding: '12px 20px', fontWeight: '600' },
  }

  const subheadEl = h1 ? all('p').find((p) => p.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_PRECEDING) : null
  const sections = []
  for (const h of all('h2, h3')) {
    if (sections.length >= 6) break
    let next = h.nextElementSibling
    while (next && !/^(P|DIV|SPAN)$/.test(next.tagName)) next = next.nextElementSibling
    sections.push({ heading: clean(h.textContent, 90), text: clean(next && next.textContent, 180) })
  }
  const content = {
    title: clean(document.title, 120),
    headline: clean(h1 && h1.textContent, 160),
    subhead: clean(subheadEl && subheadEl.textContent, 240),
    ctas: Array.from(new Set(all('a, button').map((e) => clean(e.textContent, 40)).filter((t) => t && t.length <= 30))).slice(0, 4),
    nav: Array.from(new Set(all('nav a, header a').map((e) => clean(e.textContent, 30)).filter(Boolean))).slice(0, 7),
    sections: sections.filter((s) => s.heading),
  }

  const images = all('img')
    .map((img) => ({ src: abs(img.currentSrc || img.src), area: img.getBoundingClientRect().width * img.getBoundingClientRect().height }))
    .filter((i) => /^https?:/.test(i.src) && i.area > 20000)
    .sort((a, b) => b.area - a.area)
    .map((i) => i.src)
  const logoEl = first('header img, nav img, a[href="/"] img, [class*="logo" i] img')
  return { tokens, content, images: Array.from(new Set(images)).slice(0, 6), logo: logoEl ? abs(logoEl.currentSrc || logoEl.src) : undefined }
})()`
```

- [ ] **Step 4: Test first — `server/site/capture.test.ts`**

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createCapturer } from './capture'

const FIXTURE = `<!doctype html><html><head><title>Acme | Rockets</title>
<style>body{background:#101820;color:#f2f2f2;font-family:Georgia,serif}h1{font-family:Impact,sans-serif;font-size:64px}
.btn{background:#ff5500;color:#fff;border-radius:12px;padding:14px 22px;display:inline-block}</style></head>
<body><header><nav><a href="/">Home</a><a href="/pricing">Pricing</a></nav></header>
<main><h1>Rockets for everyone</h1><p>Launch in minutes.</p><a class="btn" href="/start">Get started</a>
<h2>Fast</h2><p>Really fast.</p><h2>Safe</h2><p>Very safe.</p></main></body></html>`

const dir = mkdtempSync(join(tmpdir(), 'cap-'))
const capturer = createCapturer(dir)
afterAll(async () => {
  await capturer.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('capturer', () => {
  it('extracts style tokens and content from a page', async () => {
    const cap = await capturer.captureHtml('https://acme.test/', FIXTURE)
    expect(cap.tokens.background).toBe('rgb(16, 24, 32)')
    expect(cap.tokens.headingFont).toMatch(/Impact/)
    expect(cap.tokens.button.background).toBe('rgb(255, 85, 0)')
    expect(cap.content.headline).toBe('Rockets for everyone')
    expect(cap.content.subhead).toBe('Launch in minutes.')
    expect(cap.content.ctas).toContain('Get started')
    expect(cap.content.sections.map((s) => s.heading)).toEqual(['Fast', 'Safe'])
  }, 30_000)
})
```

Run `npx vitest run server/site` → FAIL (module missing).

- [ ] **Step 5: `server/site/capture.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser } from 'playwright'
import { INSPECT_PAGE_JS } from './inspectPage'
import type { SiteCapture } from './types'

const VIEWPORT = { width: 1280, height: 800 }
const NAV_TIMEOUT_MS = 15_000
const SETTLE_MS = 1500

export interface CaptureResult {
  capture: SiteCapture
  /** JPEG screenshot, if one was taken */
  screenshot: Buffer | null
}

const hostKey = (url: string) => new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '_')

/** Headless-Chromium site capture, cached per host in `cacheDir` (json + jpg). */
export function createCapturer(cacheDir: string) {
  let browser: Promise<Browser> | null = null
  const inFlight = new Map<string, Promise<CaptureResult>>()

  const getBrowser = () => {
    browser ??= import('playwright').then(({ chromium }) => chromium.launch())
    return browser
  }

  async function run(url: string, html?: string): Promise<CaptureResult> {
    const page = await (await getBrowser()).newPage({ viewport: VIEWPORT })
    try {
      if (html !== undefined) await page.setContent(html, { waitUntil: 'domcontentloaded' })
      else {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
        await page.waitForTimeout(SETTLE_MS)
      }
      const data = (await page.evaluate(INSPECT_PAGE_JS)) as Omit<SiteCapture, 'url'>
      const screenshot = await page.screenshot({ type: 'jpeg', quality: 70 }).catch(() => null)
      return { capture: { url, ...data }, screenshot }
    } finally {
      await page.close().catch(() => {})
    }
  }

  return {
    /** Live capture, cached per host. */
    capture(url: string): Promise<CaptureResult> {
      const key = hostKey(url)
      const json = join(cacheDir, `${key}.json`)
      const jpg = join(cacheDir, `${key}.jpg`)
      if (existsSync(json)) {
        return Promise.resolve({
          capture: JSON.parse(readFileSync(json, 'utf8')) as SiteCapture,
          screenshot: existsSync(jpg) ? readFileSync(jpg) : null,
        })
      }
      const running = inFlight.get(key)
      if (running) return running
      const job = run(url)
        .then((result) => {
          mkdirSync(cacheDir, { recursive: true })
          writeFileSync(json, JSON.stringify(result.capture, null, 2))
          if (result.screenshot) writeFileSync(jpg, result.screenshot)
          return result
        })
        .finally(() => inFlight.delete(key))
      inFlight.set(key, job)
      return job
    },
    /** For tests: inspect given HTML as if served at `url` (not cached). */
    async captureHtml(url: string, html: string): Promise<SiteCapture> {
      return (await run(url, html)).capture
    },
    async close(): Promise<void> {
      if (browser) await (await browser).close()
      browser = null
    },
  }
}

export type Capturer = ReturnType<typeof createCapturer>
```

Run `npx vitest run server/site` → pass. If an expectation is off because of how Chromium computes a value, fix `INSPECT_PAGE_JS` (not the assertion) unless the assertion contradicts the spec.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json server/site README.md
git commit -m "feat: headless site capture — style tokens, content, images, screenshot"
```

---

### Task 2: Page generation, jobs, routes

- [ ] **Step 1: Shared pair id** — create `server/pair.ts`:

```ts
import { createHash } from 'node:crypto'

/** Stable id for an ordered pair (left subject/content, right style). 16 hex chars. */
export const pairId = (aId: string, bId: string) => createHash('sha256').update(`${aId}\n${bId}`).digest('hex').slice(0, 16)
```
Replace the local `pairId` in `server/fuse/handler.ts` with an import. Run `npx vitest run server/fuse` → still pass.

- [ ] **Step 2: Options** — extend `FuseOptions`/`fuseOptionsFrom` in `server/fuse/options.ts`:
`geminiApiKey` (`GEMINI_API_KEY`, same blank handling as `apiKey`; never logged), `pageModel` (`FUSE_PAGE_MODEL`, default `'gemini-3.8-flash'`), `pageThinking` (`FUSE_PAGE_THINKING`, default `'low'`), `maxPages` (`FUSE_MAX_PAGES`, default `30`, same parsing as `maxGenerations`). Update the defaults test's expected object. Add `GEMINI_API_KEY=` to `.env.example` (with a comment: used for the fused page) and the other three under "Optional".

- [ ] **Step 3: `server/site/prompt.ts`**

```ts
import type { SiteCapture } from './types'

export interface PagePromptInput {
  contentName: string
  styleName: string
  content: SiteCapture | null
  style: SiteCapture | null
  contentUrl: string
  styleUrl: string
  /** same-origin path to the fused logo */
  logoUrl: string
}

const json = (v: unknown) => JSON.stringify(v, null, 1)

/** Left site = content and structure; right site = visual style. */
export function buildPagePrompt(p: PagePromptInput): string {
  return [
    `You are a senior web designer. Build ONE fused landing page.`,
    ``,
    `CONTENT comes from ${p.contentName} (${p.contentUrl}): what the product is, its headline, copy, sections and product imagery.`,
    `STYLE comes from ${p.styleName} (${p.styleUrl}): color palette, typography, button and card shapes, radii, shadows, spacing, overall mood.`,
    `Result: ${p.contentName}'s product, presented as if ${p.styleName}'s design team built it. Invent a short fused brand name blending both names.`,
    ``,
    `Rules:`,
    `- Output ONLY a complete HTML document (<!doctype html> … </html>). No markdown, no explanation.`,
    `- All CSS in one <style> tag. Define the style tokens as CSS custom properties on :root and use them.`,
    `- No <script>, no inline event handlers, no iframes, no forms that submit anywhere.`,
    `- Fonts: use the style site's font-family names with sensible system fallbacks. You may add one Google Fonts <link> if a family is clearly a Google font.`,
    `- Sections: sticky nav (fused logo + 3–5 links), hero (headline, subhead, primary + secondary button, a product image), 3 feature cards, a CTA band, a footer.`,
    `- Put the fused logo in the nav and once in the hero: <img src="${p.logoUrl}" alt="fused logo">.`,
    `- Images: only use URLs from the content site's "images" list below (absolute https URLs). If none, use CSS shapes/gradients in the style palette instead.`,
    `- Copy: rewrite the content site's messaging in the style site's voice; keep it about the content site's product. Short and punchy.`,
    `- Responsive (single column under 720px). Accessible contrast.`,
    ``,
    `CONTENT site capture (${p.contentName}):`,
    p.content ? json({ content: p.content.content, images: p.content.images }) : `(capture unavailable — infer from the name and URL)`,
    ``,
    `STYLE site capture (${p.styleName}):`,
    p.style ? json({ tokens: p.style.tokens, content: { title: p.style.content.title, headline: p.style.content.headline } }) : `(capture unavailable — infer the style from the name and screenshot if given)`,
    ``,
    `Screenshots follow: first the CONTENT site, then the STYLE site (if available).`,
  ].join('\n')
}
```

- [ ] **Step 4: Tests first — `server/site/generate.test.ts`**

```ts
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
```

- [ ] **Step 5: `server/site/generate.ts`**

```ts
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models'

export interface GenerateOptions {
  apiKey: string
  model: string
  /** Gemini 3 thinking level, e.g. 'low' (faster) or 'high' */
  thinking: string
}

export interface GenerateInput {
  prompt: string
  /** JPEG screenshots, content site first */
  screenshots: Buffer[]
}

/** Pulls the HTML document out of a model reply (fences, chatter). */
export function extractHtml(text: string): string {
  const start = text.search(/<!doctype html|<html[\s>]/i)
  const end = text.toLowerCase().lastIndexOf('</html>')
  if (start === -1 || end === -1 || end < start) throw new Error('the model did not return an HTML page')
  return text.slice(start, end + '</html>'.length)
}

const redact = (s: string) => s.replace(/AIza[0-9A-Za-z_-]{10,}/g, 'AIza…')

export async function generatePage(opts: GenerateOptions, input: GenerateInput, signal?: AbortSignal): Promise<string> {
  const parts: unknown[] = [{ text: input.prompt }]
  for (const shot of input.screenshots) parts.push({ inline_data: { mime_type: 'image/jpeg', data: shot.toString('base64') } })
  const r = await fetch(`${GEMINI}/${encodeURIComponent(opts.model)}:generateContent`, {
    method: 'POST',
    // key in a header, never in the URL
    headers: { 'x-goog-api-key': opts.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { thinkingConfig: { thinkingLevel: opts.thinking }, maxOutputTokens: 32768 },
    }),
    signal,
  })
  const json = (await r.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
    error?: { message?: string; status?: string }
  }
  if (r.status === 401 || r.status === 403) throw new Error('Gemini rejected the API key (check GEMINI_API_KEY on the dev server)')
  if (!r.ok) throw new Error(`Gemini: ${redact(json.error?.message ?? `HTTP ${r.status}`)}`)
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
  const u = json.usageMetadata
  console.log(`[site] ${opts.model} — ${u?.promptTokenCount ?? '?'} in / ${u?.candidatesTokenCount ?? '?'} out / ${u?.thoughtsTokenCount ?? 0} thinking tokens`)
  return extractHtml(text)
}
```

Run `npx vitest run server/site/generate.test.ts` → pass. (If the live API rejects `thinkingConfig.thinkingLevel` for this model, Task 4 adjusts it — not this task.)

- [ ] **Step 6: `server/site/jobs.ts`**

```ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FuseOptions } from '../fuse/options'
import { pairId } from '../pair'
import type { Capturer, CaptureResult } from './capture'
import { generatePage } from './generate'
import { buildPagePrompt } from './prompt'

export type SiteStatus = 'capturing' | 'generating' | 'ready' | 'error' | 'unknown'

export interface SiteRef {
  id: string
  name: string
  url: string
}

interface Job {
  status: SiteStatus
  error?: string
  controller: AbortController
}

export function createSiteJobs(options: FuseOptions, capturer: Capturer, pagesDir: string) {
  const jobs = new Map<string, Job>()
  let pages = 0

  const pageFile = (id: string) => join(pagesDir, `${id}.html`)

  async function run(id: string, a: SiteRef, b: SiteRef, job: Job): Promise<void> {
    const signal = job.controller.signal
    const safe = (p: Promise<CaptureResult>) => p.catch((err) => {
      console.warn(`[site] capture failed: ${err instanceof Error ? err.message : err}`)
      return null
    })
    const [ca, cb] = await Promise.all([safe(capturer.capture(a.url)), safe(capturer.capture(b.url))])
    if (signal.aborted) throw new Error('cancelled')
    job.status = 'generating'
    const html = await generatePage(
      { apiKey: options.geminiApiKey as string, model: options.pageModel, thinking: options.pageThinking },
      {
        prompt: buildPagePrompt({
          contentName: a.name, styleName: b.name, contentUrl: a.url, styleUrl: b.url,
          content: ca?.capture ?? null, style: cb?.capture ?? null,
          logoUrl: `/api/fuse-logo/img?id=${id}`,
        }),
        screenshots: [ca?.screenshot, cb?.screenshot].filter((s): s is Buffer => !!s),
      },
      signal,
    )
    mkdirSync(pagesDir, { recursive: true })
    writeFileSync(pageFile(id), html)
    job.status = 'ready'
  }

  return {
    pageFile,
    /** Starts (or joins) the job for an ordered pair: a = content, b = style. */
    start(a: SiteRef, b: SiteRef): { id: string; status: SiteStatus; error?: string } {
      const id = pairId(a.id, b.id)
      if (existsSync(pageFile(id))) return { id, status: 'ready' }
      const existing = jobs.get(id)
      if (existing && existing.status !== 'error') return { id, status: existing.status }
      if (!options.geminiApiKey) return { id, status: 'error', error: 'GEMINI_API_KEY is not set on the dev server' }
      if (pages >= options.maxPages) return { id, status: 'error', error: `Page limit reached (${options.maxPages}) — restart the dev server to reset` }
      pages++
      const job: Job = { status: 'capturing', controller: new AbortController() }
      jobs.set(id, job)
      run(id, a, b, job).catch((err) => {
        job.status = 'error'
        job.error = job.controller.signal.aborted ? 'cancelled' : err instanceof Error ? err.message : 'failed'
        if (!job.controller.signal.aborted) console.error(`[site] ${a.name} × ${b.name} failed: ${job.error}`)
      })
      return { id, status: job.status }
    },
    status(id: string): { status: SiteStatus; error?: string } {
      if (existsSync(pageFile(id))) return { status: 'ready' }
      const job = jobs.get(id)
      return job ? { status: job.status, error: job.error } : { status: 'unknown' }
    },
    cancel(id: string): void {
      const job = jobs.get(id)
      if (job && (job.status === 'capturing' || job.status === 'generating')) job.controller.abort()
    },
  }
}
```

- [ ] **Step 7: `server/site/handler.ts` + plugin + config**

```ts
import { existsSync, readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { createSiteJobs, SiteRef } from './jobs'

type Jobs = ReturnType<typeof createSiteJobs>

const PAGE_CSP = [
  "default-src 'none'",
  "img-src 'self' https: data:",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
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
```

`server/vite-plugin-site.ts`:
```ts
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import type { FuseOptions } from './fuse/options'
import { createCapturer } from './site/capture'
import { createSiteHandler } from './site/handler'
import { createSiteJobs } from './site/jobs'

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/** Serves /api/fuse-site: background site capture + page fusion. */
export function siteApi(options: FuseOptions): Plugin {
  const capturer = createCapturer(dir('../cache/sites'))
  const handler = createSiteHandler(createSiteJobs(options, capturer, dir('../cache/pages')))
  return {
    name: 'fuse-web-site-api',
    configureServer(server) {
      server.middlewares.use('/api/fuse-site', (req, res) => void handler(req, res))
      server.httpServer?.once('close', () => void capturer.close())
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/fuse-site', (req, res) => void handler(req, res))
    },
  }
}
```
`vite.config.ts`: compute `const fuseOptions = fuseOptionsFrom(env)` once; plugins `[logoApi(), fuseApi(fuseOptions), siteApi(fuseOptions)]`.

- [ ] **Step 8: Verify and commit**

`npm run typecheck && npx vitest run server && npm run build`; bundle check `grep -rl "OPENAI_API_KEY\|sk-" dist/ || echo "no key refs in bundle"`.

```bash
git add server vite.config.ts .env.example
git commit -m "feat: /api/fuse-site — background page fusion with Gemini"
```

---

### Task 3: Browser — start with the fuse, status on the card, fused page

- [ ] **Step 1: `src/fuse/siteJobs.ts`**

```ts
import type { Site } from '../types'

export type PageStatus = 'capturing' | 'generating' | 'ready' | 'error' | 'unknown'

const ref = (s: Site) => ({ id: s.id, name: s.name, url: s.url })

/** a = content (left slot), b = style (right slot). */
export async function startSite(a: Site, b: Site): Promise<{ id: string; status: PageStatus; error?: string }> {
  const res = await fetch('/api/fuse-site', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ a: ref(a), b: ref(b) }),
  })
  if (!res.ok) throw new Error(`site job failed to start (HTTP ${res.status})`)
  return res.json()
}

export async function siteStatus(id: string): Promise<{ status: PageStatus; error?: string }> {
  const res = await fetch(`/api/fuse-site/status?id=${encodeURIComponent(id)}`)
  return res.ok ? res.json() : { status: 'unknown' }
}

export function cancelSite(id: string): void {
  void fetch(`/api/fuse-site/cancel?id=${encodeURIComponent(id)}`, { method: 'POST', keepalive: true }).catch(() => {})
}

export const sitePageUrl = (id: string) => `/api/fuse-site/page?id=${encodeURIComponent(id)}`
```

Reference sites' `url` must be absolute https (they are, in `src/data/sites.ts`); user sites carry the URL from `/api/logo`.

- [ ] **Step 2: Scene** — `FuseState.pageStatus?: PageStatus` and `setPageStatus(fuseId, status)` (ignores a mismatched id). Import the type from `../fuse/siteJobs`. No new test needed.

- [ ] **Step 3: Renderer** — in the card status line append ` · building site…` while `pageStatus` is `capturing`/`generating`, ` · site ready ✓` when `ready`, nothing otherwise.

- [ ] **Step 4: `src/ui/fusedPair.ts`** — `saveFusedPair(a, b, storage, logoUrl?, pageId?)` stores `pageId`; `readFusedPair` returns it (string or undefined). Update the existing test's round-trip expectation to include `pageId` in one case.

- [ ] **Step 5: `src/main.ts`**
- `const siteJobs = new Map<number, string>()` (fuseId → page id).
- In `onFuse(a, b, fuseId)`: alongside the logo fuse, `startSite(a, b)` → store id, `scene?.setPageStatus(fuseId, status)`, then poll `siteStatus(id)` every 2 s while the fuse is current and status is `capturing`/`generating` (stop on `ready`/`error`/`unknown` or when the fuse id changes). A failure to start just leaves `pageStatus` undefined (logged).
- In `onFuseDismissed(fuseId)`: also `cancelSite(siteJobs.get(fuseId))`, delete the entry.
- In `onOpenFused(a, b, result)`: pass the page id (look up by the current fuse id) to `openFused(...)` → `saveFusedPair(..., pageId)`. Update `src/ui/fusedView.ts` to accept and forward `pageId`.

- [ ] **Step 6: Fused page (`src/fused.ts`, `src/fused.css`)**
- If the stored pair has a `pageId`: show the current fused-logo view plus a "building the fused site…" line with a pulsing gradient bar (A→B colors), and poll `siteStatus(pageId)` every 1.5 s. On `ready` → `location.replace(sitePageUrl(pageId))`. On `unknown` → call `startSite(a, b)` once (server restarted) and keep polling. On `error` → show the error text under the logo ("The fused site couldn't be built: …").
- If status is already `ready` on load, redirect immediately (no flash of the building view).

- [ ] **Step 7: README** — "Fused site" section: starts in the background when a fuse starts; left = content, right = style; Chromium one-time install; cached in `cache/sites` and `cache/pages`; `GEMINI_API_KEY` (page) vs `OPENAI_API_KEY` (logo), `FUSE_PAGE_MODEL`/`FUSE_PAGE_THINKING`/`FUSE_MAX_PAGES`; pages are served with scripts blocked.

- [ ] **Step 8: Verify and commit**

`npm run typecheck && npm test && npm run build` + bundle key check.

```bash
git add src README.md
git commit -m "feat: fused site builds in the background and opens when ready"
```

---

### Task 4: One live run (controller)

- [ ] Own dev server on 5299. `POST /api/fuse-site` for a = varie.ai (content), b = Spotify (style). Poll status; expect `ready` in ~30–90 s; check the `[site]` token log (Gemini); open `/api/fuse-site/page?id=…` and eyeball it (screenshot via headless Chromium). Stop the server by PID. Report time + tokens.
