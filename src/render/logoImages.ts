import type { Site } from '../types'

/** White glyph unless the brand color is very light (relative luminance > 0.7). */
export function glyphColor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.7 ? '#000000' : '#ffffff'
}

/** Image source for a site's logo: the fetched logo, or the simple-icons glyph as an SVG data URL. */
export function logoSrc(site: Site): string {
  if (site.logoUrl) return site.logoUrl
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="${glyphColor(site.color)}" d="${site.iconPath ?? ''}"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** The site's logo as an <img>, ready for canvas drawImage once loaded. */
export function logoImage(site: Site): HTMLImageElement {
  const img = new Image()
  img.src = logoSrc(site)
  return img
}
