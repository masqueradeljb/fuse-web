/** Runs inside the captured page via page.evaluate. Returns SiteCapture minus `url`. Plain JS on purpose. */
export const INSPECT_PAGE_JS = String.raw`(() => {
  const undouble = (s) => {
    const n = s.length
    if (n >= 2 && n % 2 === 0 && s.slice(0, n / 2) === s.slice(n / 2)) return s.slice(0, n / 2)
    if (n >= 3 && n % 2 === 1 && s[(n - 1) / 2] === ' ' && s.slice(0, (n - 1) / 2) === s.slice((n + 1) / 2)) return s.slice(0, (n - 1) / 2)
    return s
  }
  const clean = (s, max) => undouble((s || '').replace(/\s+/g, ' ').trim()).slice(0, max || 200)
  const txt = (el, max) => clean(el ? el.innerText || el.textContent : '', max)
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 4 && r.height > 4 && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05
  }
  const all = (sel) => Array.from(document.querySelectorAll(sel)).filter(visible)
  const first = (sel) => all(sel)[0] || null
  const style = (el) => (el ? getComputedStyle(el) : null)
  const solid = (c) => c && c !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(c)
  const abs = (u) => { try { return new URL(u, document.baseURI).href } catch { return '' } }

  const bgCandidates = [document.body, document.documentElement, first('main'), first('header'), first('section')]
  let background = 'rgb(255, 255, 255)'
  for (const el of bgCandidates) { const c = el && getComputedStyle(el).backgroundColor; if (solid(c)) { background = c; break } }

  const h1 = first('h1')
  const h1s = style(h1)
  const bodyS = getComputedStyle(document.body)
  const shortText = (el) => { const t = txt(el, 60); return t.length > 0 && t.length <= 30 }
  const hasSolidBg = (el) => solid(getComputedStyle(el).backgroundColor)
  const hasBorder = (el) => { const cs = getComputedStyle(el); return parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && solid(cs.borderTopColor) }
  const clickables = all('a, button, [role="button"]')
  const button =
    clickables.find((e) => !e.closest('nav, header') && hasSolidBg(e) && shortText(e)) ||
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
  const sectionText = (h) => {
    let anc = h.parentElement
    for (let i = 0; i < 3 && anc; i++, anc = anc.parentElement) {
      if (anc.querySelectorAll('h2, h3').length !== 1) continue
      const after = (e) => !e.contains(h) && !h.contains(e) && h.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING
      const cands = Array.from(anc.querySelectorAll('*')).filter((e) => after(e) && visible(e))
      const hit = cands.find((e) => e.tagName === 'P' && txt(e).length > 0) || cands.find((e) => txt(e).length >= 40)
      if (hit) return txt(hit, 300)
    }
    let next = h.nextElementSibling
    while (next && !/^(P|DIV|SPAN)$/.test(next.tagName)) next = next.nextElementSibling
    return txt(next, 300)
  }
  const sections = []
  for (const h of all('h2, h3')) {
    if (sections.length >= 8) break
    sections.push({ heading: txt(h, 90), text: sectionText(h) })
  }
  const ctas = Array.from(
    new Set(
      clickables
        .filter((e) => !e.closest('nav, header, footer') && (hasSolidBg(e) || hasBorder(e)) && shortText(e))
        .map((e) => txt(e, 40)),
    ),
  ).slice(0, 4)
  const nav = Array.from(new Set(all('nav a, header a').map((e) => txt(e, 30)).filter((t) => t && !ctas.includes(t)))).slice(0, 7)
  const content = {
    title: clean(document.title, 120),
    headline: txt(h1, 400).replace(/([,.;:!?])\d+(?=\s|$)/g, '$1').slice(0, 160),
    subhead: txt(subheadEl, 240),
    ctas,
    nav,
    sections: sections.filter((s) => s.heading),
  }

  const images = all('img')
    .map((img) => ({ src: abs(img.currentSrc || img.src), area: img.getBoundingClientRect().width * img.getBoundingClientRect().height }))
    .filter((i) => /^https?:/.test(i.src) && i.area > 20000)
    .sort((a, b) => b.area - a.area)
    .map((i) => i.src)
  const httpUrl = (u) => { const a = u ? abs(u) : ''; return /^https?:/.test(a) ? a : '' }
  const meta = (sel) => { const m = document.querySelector(sel); return m ? m.getAttribute('content') || '' : '' }
  const description = clean(meta('meta[name="description" i]'), 400)
  const ogImage = httpUrl(meta('meta[property="og:image" i]')) || undefined

  let box = h1 ? h1.parentElement : null
  if (h1) {
    let anc = h1.parentElement
    for (let i = 0; i < 6 && anc && anc !== document.body; i++, anc = anc.parentElement) {
      if (anc.getBoundingClientRect().height >= 300) { box = anc; break }
    }
  }
  const hero = { eyebrow: '', headline: txt(h1, 400).replace(/([,.;:!?])\d+(?=\s|$)/g, '$1').slice(0, 160), subhead: '', cta: '', media: 'none' }
  if (box && h1) {
    const before = Array.from(box.querySelectorAll('*')).filter((e) => e.children.length === 0 && !e.contains(h1) && visible(e) && (e.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING))
    const eb = before.map((e) => txt(e, 80)).filter((t) => t && t.length <= 60)
    hero.eyebrow = eb.length ? eb[eb.length - 1] : ''
    const sp = Array.from(box.querySelectorAll('p')).find((p) => visible(p) && txt(p).length > 0 && (p.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_PRECEDING))
    hero.subhead = txt(sp, 240)
    const cta = Array.from(box.querySelectorAll('a, button, [role="button"]')).find((e) => visible(e) && !e.closest('nav, header') && (hasSolidBg(e) || hasBorder(e)) && shortText(e))
    hero.cta = txt(cta, 40)
    const br = box.getBoundingClientRect()
    const overlaps = (el) => { const r = el.getBoundingClientRect(); return r.right > br.left && r.left < br.right && r.bottom > br.top && r.top < br.bottom }
    const video = Array.from(document.querySelectorAll('video')).find((v) => visible(v) && (box.contains(v) || overlaps(v)))
    if (video) {
      const srcs = [video.currentSrc, video.getAttribute('src'), ...Array.from(video.querySelectorAll('source')).map((s) => s.getAttribute('src'))]
      const src = srcs.map(httpUrl).find(Boolean)
      const poster = httpUrl(video.getAttribute('poster'))
      if (src) { hero.media = 'video'; hero.src = src }
      if (poster) hero.poster = poster
      if (!src && poster) { hero.media = 'image'; hero.src = poster }
    }
    if (hero.media === 'none') {
      const imgs = Array.from(box.querySelectorAll('img')).filter(visible).sort((x, y) => y.getBoundingClientRect().width * y.getBoundingClientRect().height - x.getBoundingClientRect().width * x.getBoundingClientRect().height)
      const src = imgs.length ? httpUrl(imgs[0].currentSrc || imgs[0].src) : ''
      if (src) { hero.media = 'image'; hero.src = src }
    }
    if (hero.media === 'none') {
      let el = box
      for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
        const m = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(el).backgroundImage || '')
        const src = m ? httpUrl(m[1]) : ''
        if (src) { hero.media = 'background'; hero.src = src; break }
      }
    }
  }
  const logoEl = first('header img, nav img, a[href="/"] img, [class*="logo" i] img')
  return { tokens, content, images: Array.from(new Set(images)).slice(0, 10), logo: logoEl ? abs(logoEl.currentSrc || logoEl.src) : undefined, hero, description, ogImage }
})()`
