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
