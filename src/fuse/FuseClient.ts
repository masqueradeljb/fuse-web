import type { Site } from '../types'

export interface FuseResult {
  siteA: string
  siteB: string
  label: string
  /** Phase 2: fused logo image */
  logoUrl?: string
  /** Phase 3: fused landing page */
  pageUrl?: string
}

export interface FuseClient {
  fuse(a: Site, b: Site): Promise<FuseResult>
}

/** Phase 1 stand-in: no backend, just a short "thinking" delay. */
export class PlaceholderFuseClient implements FuseClient {
  constructor(private delayMs = 1200) {}

  async fuse(a: Site, b: Site): Promise<FuseResult> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs))
    return { siteA: a.id, siteB: b.id, label: `${a.name} × ${b.name}` }
  }
}
