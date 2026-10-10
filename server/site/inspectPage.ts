/** Runs inside the captured page via page.evaluate. Returns SiteCapture minus `url`. Plain JS on purpose. */
export const INSPECT_PAGE_JS = String.raw`(() => {
  const clean = (s, max) => (s || '').replace(/\s+/g, ' ').trim().slice(0, max || 200)
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 4 && r.height > 4 && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05
  }
  const all = (sel) => Array.from(document.querySelectorAll(sel)).filter(visible)
  const first = (sel) => all(sel)[0] || null
  const style = (el) => (el ? getComputedStyle(el) : null)
  const solid = (c) => c && c !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(c)
  const abs = (u) => { try { return new URL(u, location.href).href } catch { return '' } }

  const bgCandidates = [document.body, document.documentElement, first('main'), first('header'), first('section')]
  let background = 'rgb(255, 255, 255)'
  for (const el of bgCandidates) { const c = el && getComputedStyle(el).backgroundColor; if (solid(c)) { background = c; break } }

  const h1 = first('h1')
  const h1s = style(h1)
  const bodyS = getComputedStyle(document.body)
  const button =
    first('a[class*="btn" i], a[class*="button" i], button[class*="primary" i], a[class*="cta" i]') ||
    first('button, [role="button"]')
  const bs = style(button)
  const accent = bs && solid(bs.backgroundColor) ? bs.backgroundColor : (style(first('a')) || bodyS).color
  const card = first('[class*="card" i], article, li[class*="item" i]')

  const tokens = {
    background,
    text: bodyS.color,
    accent,
    headingFont: (h1s || bodyS).fontFamily,
    bodyFont: bodyS.fontFamily,
    h1Size: h1s ? h1s.fontSize : '48px',
    radius: (style(card) || bs || bodyS).borderRadius || '0px',
    shadow: (style(card) || bodyS).boxShadow || 'none',
    button: bs
      ? { background: bs.backgroundColor, color: bs.color, radius: bs.borderRadius, padding: bs.padding, fontWeight: bs.fontWeight }
      : { background: accent, color: '#ffffff', radius: '8px', padding: '12px 20px', fontWeight: '600' },
  }

  const subheadEl = h1 ? all('p').find((p) => p.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_PRECEDING) : null
  const sections = []
  for (const h of all('h2, h3')) {
    if (sections.length >= 6) break
    let next = h.nextElementSibling
    while (next && !/^(P|DIV|SPAN)$/.test(next.tagName)) next = next.nextElementSibling
    sections.push({ heading: clean(h.textContent, 90), text: clean(next && next.textContent, 180) })
  }
  const content = {
    title: clean(document.title, 120),
    headline: clean(h1 && h1.textContent, 160),
    subhead: clean(subheadEl && subheadEl.textContent, 240),
    ctas: Array.from(new Set(all('a, button').map((e) => clean(e.textContent, 40)).filter((t) => t && t.length <= 30))).slice(0, 4),
    nav: Array.from(new Set(all('nav a, header a').map((e) => clean(e.textContent, 30)).filter(Boolean))).slice(0, 7),
    sections: sections.filter((s) => s.heading),
  }

  const images = all('img')
    .map((img) => ({ src: abs(img.currentSrc || img.src), area: img.getBoundingClientRect().width * img.getBoundingClientRect().height }))
    .filter((i) => /^https?:/.test(i.src) && i.area > 20000)
    .sort((a, b) => b.area - a.area)
    .map((i) => i.src)
  const logoEl = first('header img, nav img, a[href="/"] img, [class*="logo" i] img')
  return { tokens, content, images: Array.from(new Set(images)).slice(0, 6), logo: logoEl ? abs(logoEl.currentSrc || logoEl.src) : undefined }
})()`
