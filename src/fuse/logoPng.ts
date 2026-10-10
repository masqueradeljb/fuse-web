import { logoSrc } from '../render/logoImages'
import type { Site } from '../types'

/**
 * The logo as the model should see it: a square PNG data URL. Reference sites: glyph on
 * their brand color (that color is the style we want carried over). Your sites: the logo
 * on white (or its dark backing).
 */
export async function renderLogoPng(site: Site, size = 512): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error(`Could not load the ${site.name} logo`))
    el.src = logoSrc(site)
  })
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  ctx.fillStyle = site.logoUrl ? (site.logoBg ?? '#ffffff') : site.color
  ctx.fillRect(0, 0, size, size)
  const box = size * 0.7
  const w = img.naturalWidth || box
  const h = img.naturalHeight || box
  const k = box / Math.max(w, h)
  ctx.drawImage(img, (size - w * k) / 2, (size - h * k) / 2, w * k, h * k)
  return canvas.toDataURL('image/png')
}
