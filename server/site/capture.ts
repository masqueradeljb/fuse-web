import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser } from 'playwright'
import { INSPECT_PAGE_JS, MARK_SNAPSHOTS_JS } from './inspectPage'
import { guardedFetch, readCapped } from '../logo/handler'
import { parseTags, siteName } from '../logo/parse'
import type { SiteCapture } from './types'

const VIEWPORT = { width: 1280, height: 800 }
const NAV_TIMEOUT_MS = 15_000
const SETTLE_MS = 1500
const BOT_WAIT_MS = 8000
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const BOT_RE = /just a moment|attention required|verify(ing)? (that )?(you are|you're) (not a bot|human)|security service|checking your browser|enable javascript and cookies/i

/** True if a page title/body looks like a bot-check interstitial. */
export const looksBlocked = (title: string, body: string): boolean => BOT_RE.test(title) || (body.length < 200 && BOT_RE.test(body)) || BOT_RE.test(body.slice(0, 600))

export interface CaptureResult {
  capture: SiteCapture
  /** JPEG screenshot, if one was taken */
  screenshot: Buffer | null
}

/** host + path slug, so different pages of one host don't collide */
export const hostKey = (url: string) => {
  const u = new URL(url)
  const path = u.pathname.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9.-]+/gi, '_')
  return `${u.hostname}${path ? `_${path}` : ''}`.replace(/[^a-z0-9._-]/gi, '_').slice(0, 120)
}

const NEUTRAL_TOKENS: SiteCapture['tokens'] = {
  background: 'rgb(255, 255, 255)', text: 'rgb(0, 0, 0)', accent: 'rgb(0, 0, 0)',
  headingFont: 'sans-serif', bodyFont: 'sans-serif', h1Size: '48px', radius: '8px', shadow: 'none',
  button: { background: 'rgb(0, 0, 0)', color: 'rgb(255, 255, 255)', radius: '8px', padding: '12px 20px', fontWeight: '600' },
}

/** Plain-fetch fallback for a blocked page: title, description, og:image only. */
async function blockedCapture(url: string): Promise<SiteCapture> {
  let html = ''
  try {
    const r = await guardedFetch(new URL(url), { headers: { 'user-agent': UA, accept: 'text/html' } })
    if (r?.ok) html = (await readCapped(r, 1_000_000, true))?.toString('utf8') ?? ''
  } catch {
    /* keep empty */
  }
  const page = new URL(url)
  const metas = html ? parseTags(html, 'meta') : []
  const meta = (k: string) => metas.find((m) => (m.name ?? m.property ?? '').toLowerCase() === k)?.content?.trim() ?? ''
  let ogImage: string | undefined
  try {
    const og = meta('og:image')
    ogImage = og ? new URL(og, page).href : undefined
  } catch {
    /* ignore */
  }
  const title = html ? siteName(html, page) : page.hostname
  return {
    url, blocked: true, tokens: NEUTRAL_TOKENS,
    content: { title, headline: title, subhead: '', ctas: [], nav: [], sections: [] },
    images: [], media: [], videos: [], snapshots: [], description: meta('description').slice(0, 400), ogImage,
    hero: { eyebrow: '', headline: title, subhead: '', cta: '', media: 'none' },
  }
}

/** Headless-Chromium site capture, cached per host in `cacheDir` (json + jpg). */
/** Hides cookie/consent overlays (known vendors, plus fixed/sticky boxes mentioning cookies). Plain JS on purpose. */
const HIDE_CONSENT_JS = String.raw`(() => {
  const known = '#onetrust-consent-sdk, #onetrust-banner-sdk, #CybotCookiebotDialog, #usercentrics-root, #truste-consent-track, .cc-window, .cky-consent-container, .osano-cm-window, [id^="sp_message_container"]'
  document.querySelectorAll(known).forEach((el) => el.style.setProperty('display', 'none', 'important'))
  const words = /cookie|consent|privacy preferences|gdpr/i
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el)
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue
    if (el.closest('header, nav')) continue
    const text = (el.innerText || '').slice(0, 600)
    if (words.test(text) && text.length < 1500) el.style.setProperty('display', 'none', 'important')
  }
})()`

export function createCapturer(cacheDir: string) {
  let browser: Promise<Browser> | null = null
  const inFlight = new Map<string, Promise<CaptureResult>>()

  const getBrowser = () => {
    browser ??= import('playwright').then(({ chromium }) => chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] }))
    return browser
  }

  async function run(url: string, html?: string): Promise<CaptureResult> {
    const key = hostKey(url)
    const context = await (await getBrowser()).newContext({
      viewport: VIEWPORT, userAgent: UA, locale: 'en-US', extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9' },
    })
    const page = await context.newPage()
    const videos: string[] = []
    page.on('response', (r) => {
      try {
        const u = new URL(r.url())
        if (!/^https?:$/.test(u.protocol)) return
        const isVideo = (r.headers()['content-type'] ?? '').toLowerCase().startsWith('video/') || /\.(mp4|webm)$/i.test(u.pathname)
        const clean = u.origin + u.pathname
        if (isVideo && videos.length < 4 && !videos.some((v) => v.split('?')[0] === clean)) videos.push(r.url())
      } catch {
        /* ignore */
      }
    })
    try {
      if (html !== undefined) await page.setContent(html, { waitUntil: 'domcontentloaded' })
      else {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
        await page.waitForTimeout(SETTLE_MS)
      }
      const probe = () => page.evaluate(() => [document.title, (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim()]).catch(() => ['', ''])
      let [title, body] = await probe()
      for (let waited = 0; looksBlocked(title, body) && waited < BOT_WAIT_MS; waited += 1000) {
        await page.waitForTimeout(1000)
        ;[title, body] = await probe()
      }
      if (looksBlocked(title, body)) return { capture: await blockedCapture(url), screenshot: null }
      // trigger lazy-loaded media
      for (let i = 0; i < 4; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight)).catch(() => {})
        await page.waitForTimeout(400)
      }
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
      await page.waitForTimeout(500)
      // keep cookie/consent popups out of snapshots and the screenshot
      await page.evaluate(HIDE_CONSENT_JS).catch(() => {})
      const data = (await page.evaluate(INSPECT_PAGE_JS)) as Omit<SiteCapture, 'url'>
      data.videos = videos
      if (data.hero.media === 'video' && !data.hero.src && videos[0]) data.hero.src = videos[0]
      if (data.hero.media === 'video' && !data.hero.src) data.hero.media = data.hero.poster ? 'image' : 'none'
      if (data.hero.media === 'image' && !data.hero.src && data.hero.poster) data.hero.src = data.hero.poster
      // the top-of-page screenshot first: taking snapshots scrolls the page
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
      const screenshot = await page.screenshot({ type: 'jpeg', quality: 70 }).catch(() => null)
      data.snapshots = []
      try {
        const marks = (await page.evaluate(MARK_SNAPSHOTS_JS)) as { n: number; w: number; h: number }[]
        for (const m of marks) {
          const buf = await page.locator(`[data-fuse-snap="${m.n}"]`).first().screenshot({ type: 'jpeg', quality: 75, timeout: 4000 }).catch(() => null)
          if (!buf) continue
          mkdirSync(cacheDir, { recursive: true })
          writeFileSync(join(cacheDir, `${key}-snap-${m.n}.jpg`), buf)
          data.snapshots.push({ url: `/api/fuse-site/asset?key=${encodeURIComponent(key)}&n=${m.n}`, w: m.w, h: m.h })
        }
      } catch {
        /* snapshots are optional */
      }
      return { capture: { url, ...data }, screenshot }
    } finally {
      await context.close().catch(() => {})
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
          if (result.capture.blocked) return result
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
