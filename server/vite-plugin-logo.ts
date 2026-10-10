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
