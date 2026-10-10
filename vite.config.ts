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
