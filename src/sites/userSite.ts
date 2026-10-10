import type { Site } from '../types'
import { dominantColor, isMostlyWhite } from './dominantColor'

interface LogoInfo {
  id: string
  name: string
  url: string
  logoUrl: string
}

const SIZE = 256

/**
 * Asks the dev server for a site's logo, rasterizes it once into a 256×256 PNG data URL
 * (so SVGs without an intrinsic size still render, and the logo no longer depends on the
 * server's cache), then samples its brand color.
 */
export async function fetchUserSite(input: string): Promise<Site> {
  const res = await fetch(`/api/logo?url=${encodeURIComponent(input)}`)
  const body = (await res.json().catch(() => ({}))) as Partial<LogoInfo> & { error?: string }
  if (!res.ok || !body.logoUrl || !body.id) throw new Error(body.error ?? `Logo lookup failed (HTTP ${res.status})`)
  const img = await loadImage(body.logoUrl)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas unavailable')
  drawContain(ctx, img)
  let color = '#888888'
  let logoBg: string | undefined
  try {
    const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data
    color = dominantColor(rgba)
    if (isMostlyWhite(rgba)) logoBg = '#111111'
  } catch {
    // tainted canvas: keep the neutral color
  }
  return {
    id: body.id,
    name: body.name ?? body.id,
    url: body.url ?? input,
    logoUrl: canvas.toDataURL('image/png'),
    color,
    ...(logoBg ? { logoBg } : {}),
  }
}

function drawContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement): void {
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (!w || !h) {
    ctx.drawImage(img, 0, 0, SIZE, SIZE) // e.g. SVG without intrinsic size
    return
  }
  const k = Math.min(SIZE / w, SIZE / h)
  ctx.drawImage(img, (SIZE - w * k) / 2, (SIZE - h * k) / 2, w * k, h * k)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('The logo image could not be loaded'))
    img.src = src
  })
}
