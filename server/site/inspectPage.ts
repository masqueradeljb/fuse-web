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
      if (!src) hero.media = 'video'
    }
    if (hero.media === 'none') {
      const imgs = Array.from(box.querySelectorAll('img')).filter(visible).sort((x, y) => y.getBoundingClientRect().width * y.getBoundingClientRect().height - x.getBoundingClientRect().width * x.getBoundingClientRect().height)
      const big = imgs.filter((i) => { const r = i.getBoundingClientRect(); return r.width >= 200 && r.height >= 150 })
      const src = big.length ? httpUrl(big[0].currentSrc || big[0].src) : ''
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
  const media = []
  const seen = new Set()
  const addMedia = (kind, src, r, alt) => {
    if (!src || seen.has(src) || r.width < 300 || r.height < 200) return
    seen.add(src)
    media.push({ kind, src, w: Math.round(r.width), h: Math.round(r.height), alt: clean(alt, 120) })
  }
  // an image with other visible content drawn over it is a layer (texture, frame, backdrop), not a picture:
  // on its own it renders as an empty box. Product snapshots capture the finished composite instead.
  const overlap = (a, b) => {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    return w > 0 && h > 0 ? (w * h) / Math.max(1, a.width * a.height) : 0
  }
  const isLayer = (el) => {
    const r = el.getBoundingClientRect()
    let box = el.parentElement
    for (let i = 0; i < 3 && box && box !== document.body; i++, box = box.parentElement) {
      for (const other of box.querySelectorAll('img, svg, canvas, video, picture, p, span, h1, h2, h3, h4, li, button, [style*="background"]')) {
        if (other === el || other.contains(el) || el.contains(other) || !visible(other)) continue
        const text = /^(P|SPAN|H\d|LI|BUTTON)$/.test(other.tagName) ? (other.innerText || '').trim() : 'x'
        if (text && overlap(r, other.getBoundingClientRect()) > 0.15) return true
      }
    }
    return false
  }
  for (const img of all('img')) {
    if (!isLayer(img)) addMedia('image', httpUrl(img.currentSrc || img.src), img.getBoundingClientRect(), img.alt)
  }
  for (const v of all('video')) {
    const r = v.getBoundingClientRect()
    const vs = [v.currentSrc, v.getAttribute('src'), ...Array.from(v.querySelectorAll('source')).map((s) => s.getAttribute('src'))].map(httpUrl).find(Boolean)
    if (vs) addMedia('video', vs, r, v.getAttribute('aria-label') || '')
    else addMedia('image', httpUrl(v.getAttribute('poster')), r, '')
  }
  for (const el of Array.from(document.querySelectorAll('body *')).slice(0, 3000)) {
    if (el.tagName === 'IMG' || el.tagName === 'VIDEO') continue
    const m = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(el).backgroundImage || '')
    if (!m) continue
    const r = el.getBoundingClientRect()
    // CSS backgrounds under content are backdrops; keep only ones with nothing drawn on top
    if (r.width >= 300 && r.height >= 200 && visible(el) && !(el.innerText || '').trim() && !el.querySelector('img, svg, canvas, video') && !isLayer(el)) {
      addMedia('image', httpUrl(m[1]), r, el.getAttribute('aria-label') || '')
    }
  }
  media.sort((x, y) => y.w * y.h - x.w * x.h)
  const logoEl = first('header img, nav img, a[href="/"] img, [class*="logo" i] img')
  return { tokens, content, images: Array.from(new Set(images)).slice(0, 10), logo: logoEl ? abs(logoEl.currentSrc || logoEl.src) : undefined, hero, description, ogImage, media: media.slice(0, 12), videos: [], snapshots: [] }
})()`


/** Marks up to 4 big, non-overlapping, visually heavy blocks with data-fuse-snap and returns their sizes. */
export const MARK_SNAPSHOTS_JS = String.raw`(() => {
  const chosen = []
  const out = []
  const cands = Array.from(document.querySelectorAll('section, div, figure, main > *, article'))
    .filter((el) => !el.closest('header, nav, footer'))
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ el, r }) => {
      const cs = getComputedStyle(el)
      if (r.width < 480 || r.height < 280 || r.height > 1600 || cs.display === 'none' || cs.visibility === 'hidden') return false
      const hasBg = /url\(/.test(cs.backgroundImage || '')
      return hasBg || !!el.querySelector('img, video, canvas, svg')
    })
    .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)
  for (const { el, r } of cands) {
    if (chosen.length >= 4) break
    if (r.width * r.height > innerWidth * innerHeight * 6) continue
    const overlaps = chosen.some((c) => c.el.contains(el) || el.contains(c.el) || !(r.right <= c.r.left || r.left >= c.r.right || r.bottom <= c.r.top || r.top >= c.r.bottom))
    if (overlaps) continue
    chosen.push({ el, r })
  }
  chosen.sort((a, b) => a.r.top - b.r.top)
  chosen.forEach(({ el, r }, n) => { el.setAttribute('data-fuse-snap', String(n)); out.push({ n, w: Math.round(r.width), h: Math.round(r.height) }) })
  return out
})()`
