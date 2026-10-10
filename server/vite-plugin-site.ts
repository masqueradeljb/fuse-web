import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import type { FuseOptions } from './fuse/options'
import { createCapturer } from './site/capture'
import { createSiteHandler } from './site/handler'
import { createSiteJobs } from './site/jobs'

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/** Serves /api/fuse-site: background site capture + page fusion. */
export function siteApi(options: FuseOptions): Plugin {
  const sitesDir = dir('../cache/sites')
  const capturer = createCapturer(sitesDir)
  const handler = createSiteHandler(createSiteJobs(options, capturer, dir('../cache/pages')), sitesDir)
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
