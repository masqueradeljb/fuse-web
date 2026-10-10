export type Attrs = Record<string, string>

const TAG = /<(link|meta)\b([^>]*)>/gi
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

const decodeEntities = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** Everything before </head>, or the first 200k chars. */
const headOf = (html: string) => {
  const i = html.search(/<\/head>/i)
  return i === -1 ? html.slice(0, 200_000) : html.slice(0, i)
}

/** 'example.com' → https URL. Null for non-http(s), unparsable, dotless or private hosts. */
export function normalizeUrl(input: string): URL | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!url.hostname.includes('.') || isBlockedHost(url.hostname)) return null
  return url
}

/** Rough guard for a local demo: loopback, private, link-local and local names, by name or IPv4 literal. */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h.includes(':') || h.startsWith('[')) return true // IPv6 literals: block all
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

export function parseTags(html: string, name: 'link' | 'meta'): Attrs[] {
  const out: Attrs[] = []
  for (const m of html.matchAll(TAG)) {
    if (m[1].toLowerCase() !== name) continue
    const attrs: Attrs = {}
    for (const a of m[2].matchAll(ATTR)) attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '')
    out.push(attrs)
  }
  return out
}

const largestSize = (sizes: string | undefined) =>
  Math.max(0, ...(sizes ?? '').split(/\s+/).map((s) => parseInt(s, 10) || 0))

/** Absolute logo URLs, best first. Ends with /favicon.ico, then gstatic's favicon service (404s for unknown sites). */
export function iconCandidates(html: string, page: URL): string[] {
  const ranked: { href: string; score: number }[] = []
  for (const link of parseTags(headOf(html), 'link')) {
    const rels = (link.rel ?? '').toLowerCase().split(/\s+/)
    if (!link.href || rels.includes('mask-icon')) continue
    if (rels.includes('apple-touch-icon') || rels.includes('apple-touch-icon-precomposed')) {
      ranked.push({ href: link.href, score: 3000 + largestSize(link.sizes) })
    } else if (rels.includes('icon')) {
      const svg = (link.type ?? '').includes('svg') || /\.svg(\?|$)/i.test(link.href)
      ranked.push({ href: link.href, score: svg ? 2500 : 1000 + largestSize(link.sizes) })
    }
  }
  ranked.sort((a, b) => b.score - a.score)
  const urls: string[] = []
  for (const { href } of ranked) {
    try {
      urls.push(new URL(href, page).href)
    } catch {
      // unparsable href: skip
    }
  }
  urls.push(`${page.origin}/favicon.ico`)
  urls.push(`https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(page.origin)}&size=256`)
  return [...new Set(urls)]
}

export function siteName(html: string, page: URL): string {
  const head = headOf(html)
  const og = parseTags(head, 'meta').find((m) => (m.property ?? '').toLowerCase() === 'og:site_name')?.content?.trim()
  if (og) return og
  const title = decodeEntities(head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '')
  const first = title.split(/\s[|\-–—:·]\s/)[0].trim()
  if (first && first.length <= 40) return first
  return page.hostname.replace(/^www\./, '')
}
