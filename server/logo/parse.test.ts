import { describe, expect, it } from 'vitest'
import { iconCandidates, isBlockedHost, normalizeUrl, parseTags, siteName } from './parse'

const page = new URL('https://www.example.com/home')

describe('normalizeUrl', () => {
  it('adds https:// to a bare domain', () => {
    expect(normalizeUrl(' example.com ')?.href).toBe('https://example.com/')
  })
  it('keeps http(s) URLs', () => {
    expect(normalizeUrl('http://example.com/a')?.href).toBe('http://example.com/a')
  })
  it('rejects other schemes, junk, dotless and private hosts', () => {
    for (const bad of ['', 'ftp://example.com', 'not a url', 'intranet', 'localhost:3000', '127.0.0.1', '192.168.1.5', 'http://10.0.0.1']) {
      expect(normalizeUrl(bad)).toBeNull()
    }
  })
})

describe('isBlockedHost', () => {
  it('blocks loopback, private, link-local and local names', () => {
    for (const h of ['localhost', 'a.localhost', 'printer.local', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.1.1', '0.0.0.0', '[::1]']) {
      expect(isBlockedHost(h)).toBe(true)
    }
  })
  it('allows public hosts', () => {
    for (const h of ['example.com', '8.8.8.8', '172.32.0.1']) expect(isBlockedHost(h)).toBe(false)
  })
})

describe('parseTags', () => {
  it('reads attributes with any quoting and decodes entities', () => {
    const html = `<link rel="icon" href='/a.png?x=1&amp;y=2' sizes=32x32><meta property="og:site_name" content="Ex">`
    expect(parseTags(html, 'link')).toEqual([{ rel: 'icon', href: '/a.png?x=1&y=2', sizes: '32x32' }])
    expect(parseTags(html, 'meta')).toEqual([{ property: 'og:site_name', content: 'Ex' }])
  })
})

describe('iconCandidates', () => {
  it('ranks apple-touch-icon, then SVG, then larger icons, then /favicon.ico and gstatic; skips mask-icon', () => {
    const html = `<head>
      <link rel="icon" href="/16.png" sizes="16x16">
      <link rel="icon" href="/64.png" sizes="64x64">
      <link rel="mask-icon" href="/mask.svg">
      <link rel="icon" type="image/svg+xml" href="/logo.svg">
      <link rel="apple-touch-icon" href="https://cdn.example.com/touch.png" sizes="180x180">
    </head><body><link rel="icon" href="/ignored-body.png"></body>`
    expect(iconCandidates(html, page)).toEqual([
      'https://cdn.example.com/touch.png',
      'https://www.example.com/logo.svg',
      'https://www.example.com/64.png',
      'https://www.example.com/16.png',
      'https://www.example.com/favicon.ico',
      'https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https%3A%2F%2Fwww.example.com&size=256',
    ])
  })
  it('falls back to Google favicons for empty HTML', () => {
    expect(iconCandidates('', page)).toEqual([
      'https://www.example.com/favicon.ico',
      'https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https%3A%2F%2Fwww.example.com&size=256',
    ])
  })
})

describe('siteName', () => {
  it('prefers og:site_name', () => {
    expect(siteName('<meta property="og:site_name" content="Example Co"><title>Home | Other</title>', page)).toBe('Example Co')
  })
  it('uses the first title segment', () => {
    expect(siteName('<title>Example &amp; Co — Build things</title>', page)).toBe('Example & Co')
  })
  it('falls back to the hostname without www', () => {
    expect(siteName('', page)).toBe('example.com')
  })
})
