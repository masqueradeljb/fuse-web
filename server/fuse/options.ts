export interface FuseOptions {
  /** never logged or sent to the browser */
  apiKey: string | undefined
  model: string
  quality: string
  size: string
  maxGenerations: number
  /** Gemini key for the fused page; never logged or sent to the browser */
  geminiApiKey: string | undefined
  pageModel: string
  pageThinking: string
  maxPages: number
}

type Env = Record<string, string | undefined>

const nonBlank = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined)

export function fuseOptionsFrom(env: Env): FuseOptions {
  const size = nonBlank(env.FUSE_IMAGE_SIZE)
  const max = Number.parseInt(env.FUSE_MAX_GENERATIONS ?? '', 10)
  const maxPages = Number.parseInt(env.FUSE_MAX_PAGES ?? '', 10)
  return {
    apiKey: nonBlank(env.OPENAI_API_KEY),
    model: nonBlank(env.FUSE_IMAGE_MODEL) ?? 'gpt-image-2.5-sunburst',
    quality: nonBlank(env.FUSE_IMAGE_QUALITY) ?? 'medium',
    size: size && /^\d+x\d+$/.test(size) ? size : '1024x1024',
    maxGenerations: Number.isFinite(max) && max >= 0 ? max : 50,
    geminiApiKey: nonBlank(env.GEMINI_API_KEY),
    pageModel: nonBlank(env.FUSE_PAGE_MODEL) ?? 'gemini-3.8-flash',
    pageThinking: nonBlank(env.FUSE_PAGE_THINKING) ?? 'low',
    maxPages: Number.isFinite(maxPages) && maxPages >= 0 ? maxPages : 30,
  }
}
