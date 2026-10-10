import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FuseOptions } from '../fuse/options'
import { guardedFetch, readCapped } from '../logo/handler'
import { pairId } from '../pair'
import type { Capturer, CaptureResult } from './capture'
import { generatePage } from './generate'
import { generateHero } from './hero'
import { buildPagePrompt } from './prompt'
import type { SiteCapture } from './types'

const MAX_REF_BYTES = 4_000_000
const UA = 'Mozilla/5.0 (compatible; fuse-web)'

type RefImage = { buffer: Buffer; type: 'image/png' | 'image/jpeg' }

/** Candidate URLs for the reference hero visual, best first. */
const heroCandidates = (c: SiteCapture | null): string[] => {
  if (!c) return []
  const h = c.hero
  const list = [h.poster, h.media === 'image' || h.media === 'background' ? h.src : undefined, c.ogImage]
  return Array.from(new Set(list.filter((u): u is string => !!u)))
}

async function downloadRef(src: string): Promise<RefImage | null> {
  try {
    const r = await guardedFetch(new URL(src), { headers: { 'user-agent': UA, accept: 'image/png,image/jpeg' } })
    if (!r) return null
    const type = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!r.ok || (type !== 'image/png' && type !== 'image/jpeg')) {
      void r.body?.cancel().catch(() => {})
      return null
    }
    const buffer = await readCapped(r, MAX_REF_BYTES)
    return buffer && buffer.length > 0 ? { buffer, type } : null
  } catch {
    return null
  }
}

/** Width/height from PNG or JPEG header bytes; null if unreadable. */
export function imageSize(b: Buffer): { w: number; h: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) { i++; continue }
      const m = b[i + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }
      i += 2 + b.readUInt16BE(i + 2)
    }
  }
  return null
}

/** Reference hero visual from the STYLE site only; real images at least 400x300. */
async function pickReference(c: SiteCapture | null, screenshot: Buffer | null): Promise<RefImage | null> {
  for (const src of heroCandidates(c)) {
    if (/\.(ico|svg)(\?|#|$)/i.test(src)) continue
    const img = await downloadRef(src)
    const size = img ? imageSize(img.buffer) : null
    if (img && size && size.w >= 400 && size.h >= 300) return img
  }
  return screenshot ? { buffer: screenshot, type: 'image/jpeg' } : null
}

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
  const heroFile = (id: string) => join(pagesDir, `${id}-hero.png`)
  /** reference hero URL to redirect to when no image was generated */
  const heroFallbacks = new Map<string, string>()

  async function run(id: string, a: SiteRef, b: SiteRef, job: Job): Promise<void> {
    const signal = job.controller.signal
    const safe = (p: Promise<CaptureResult>) => p.catch((err) => {
      console.warn(`[site] capture failed: ${err instanceof Error ? err.message : err}`)
      return null
    })
    const [ca, cb] = await Promise.all([safe(capturer.capture(a.url)), safe(capturer.capture(b.url))])
    if (signal.aborted) throw new Error('cancelled')
    job.status = 'generating'
    const heroUrl = `/api/fuse-site/hero?id=${id}`
    const fallback = heroCandidates(cb?.capture ?? null)[0]
    if (fallback) heroFallbacks.set(id, fallback)

    const makeHero = async (): Promise<void> => {
      if (!options.apiKey) return
      const ref = await pickReference(cb?.capture ?? null, cb?.screenshot ?? null)
      if (!ref) throw new Error('no reference image')
      const summary = (ca?.capture.description || ca?.capture.hero.subhead || ca?.capture.content.headline || a.name).slice(0, 200)
      const png = await generateHero(options, { productName: a.name, productSummary: summary, styleName: b.name, reference: ref.buffer, referenceType: ref.type }, signal)
      mkdirSync(pagesDir, { recursive: true })
      writeFileSync(heroFile(id), png)
    }
    const makePage = () =>
      generatePage(
        { apiKey: options.geminiApiKey as string, model: options.pageModel, thinking: options.pageThinking },
        {
          prompt: buildPagePrompt({
            contentName: a.name, styleName: b.name, contentUrl: a.url, styleUrl: b.url,
            content: ca?.capture ?? null, style: cb?.capture ?? null,
            logoUrl: `/api/fuse-logo/img?id=${id}`,
            heroImageUrl: heroUrl,
          }),
          screenshots: [ca?.screenshot, cb?.screenshot].filter((s): s is Buffer => !!s),
        },
        signal,
      )
    const [page, hero] = await Promise.allSettled([makePage(), makeHero()])
    if (hero.status === 'rejected') console.warn(`[site] hero image failed: ${hero.reason instanceof Error ? hero.reason.message : 'error'}`)
    if (page.status === 'rejected') throw page.reason
    const html = page.value
    mkdirSync(pagesDir, { recursive: true })
    writeFileSync(pageFile(id), html)
    job.status = 'ready'
  }

  return {
    pageFile,
    heroFile,
    heroFallback: (id: string): string | undefined => heroFallbacks.get(id),
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
