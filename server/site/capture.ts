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
