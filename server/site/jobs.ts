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
