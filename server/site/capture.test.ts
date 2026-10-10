import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createCapturer, looksBlocked } from './capture'

const FIXTURE = `<!doctype html><html><head><title>Acme | Rockets</title><base href="https://acme.test/"><meta name="description" content="Rockets for the people.">
<style>body{background:#101820;color:#f2f2f2;font-family:Georgia,serif}h1{font-family:Impact,sans-serif;font-size:64px}
.btn{background:#ff5500;color:#fff;border-radius:12px;padding:14px 22px;display:inline-block}</style></head>
<body><header><nav><a href="/">Home</a><a href="/pricing">Pricing</a></nav></header>
<main><section style="height:400px"><video poster="/p.jpg" style="width:300px;height:200px"><source src="/v.mp4"></video><h1>Rockets for everyone</h1><p>Launch in minutes.</p><a class="btn" href="/start">Get started</a></section>
<h2>Fast</h2><p>Really fast.</p><h2>Safe</h2><p>Very safe.</p></main></body></html>`

const FIXTURE2 = `<!doctype html><html><head><title>Beta</title>
<style>button{background:transparent;border:0}.go{background:#0a7;color:#fff;padding:10px 18px;border:0}</style></head>
<body><header><nav><button>Menu</button><a href="/a">Sign in</a><a href="/b">Docs</a></nav></header>
<main><h1>Big idea,1 for all</h1><p>Sub.</p><button class="go">Try it</button>
<section><div><h2>Wide</h2></div><div><span>Nested text that is definitely longer than forty characters.</span></div></section>
<section><h2>Tall</h2><p>Plain paragraph.</p></section></main></body></html>`

const dir = mkdtempSync(join(tmpdir(), 'cap-'))
const capturer = createCapturer(dir)
afterAll(async () => {
  await capturer.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('capturer', () => {
  it('extracts style tokens and content from a page', async () => {
    const cap = await capturer.captureHtml('https://acme.test/', FIXTURE)
    expect(cap.tokens.background).toBe('rgb(16, 24, 32)')
    expect(cap.tokens.headingFont).toMatch(/Impact/)
    expect(cap.tokens.button.background).toBe('rgb(255, 85, 0)')
    expect(cap.content.headline).toBe('Rockets for everyone')
    expect(cap.content.subhead).toBe('Launch in minutes.')
    expect(cap.content.ctas).toContain('Get started')
    expect(cap.content.sections.map((s) => s.heading)).toEqual(['Fast', 'Safe'])

    expect(cap.hero.media).toBe('video')
    expect(cap.hero.src).toMatch(/\/v\.mp4$/)
    expect(cap.hero.poster).toMatch(/\/p\.jpg$/)
    expect(cap.description).toBe('Rockets for the people.')

    const cap2 = await capturer.captureHtml('https://beta.test/', FIXTURE2)
    expect(cap2.tokens.button.background).toBe('rgb(0, 170, 119)')
    expect(cap2.tokens.accent).toBe('rgb(0, 170, 119)')
    expect(cap2.content.ctas).toEqual(['Try it'])
    expect(cap2.content.nav).toEqual(['Sign in', 'Docs'])
    expect(cap2.content.headline).toBe('Big idea, for all')
    expect(cap2.content.sections).toEqual([
      { heading: 'Wide', text: 'Nested text that is definitely longer than forty characters.' },
      { heading: 'Tall', text: 'Plain paragraph.' },
    ])
  }, 30_000)

  it('detects bot-check pages', () => {
    expect(looksBlocked('Just a moment...', '')).toBe(true)
    expect(looksBlocked('Lovable', 'This website uses a security service to protect itself. Verifying you are not a bot')).toBe(true)
    expect(looksBlocked('Acme | Rockets', 'Rockets for everyone. Launch in minutes. '.repeat(20))).toBe(false)
  })
})
