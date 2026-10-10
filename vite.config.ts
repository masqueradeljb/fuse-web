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
