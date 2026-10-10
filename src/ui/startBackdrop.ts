import { logoImage } from '../render/logoImages'
import type { Site } from '../types'

/**
 * Landing-page backdrop: drifting brand-color light, twinkling dust, and logo orbs that bounce,
 * collide, and every few seconds get pulled together and fuse (squash → flash → split orb → split).
 * Echoes the stage's collision fuse. Static single frame under prefers-reduced-motion.
 */

const AMBIENT = 60
const MAX_PARTICLES = 200
const MAX_FUSIONS = 2
const SQUASH_MS = 420
const MERGED_MS = 2100
const GROW_MS = 380
const SEEK_TIMEOUT_MS = 6000
const COOLDOWN_MS = 4000
const BLOB_SCALE = 1 / 6 // blobs are soft: render them small and upscale
const SPRITE_R = 64 // orb sprite radius in device px before dpr (covers the largest orb)
const HALO = 1.55 // halo radius as a multiple of the orb radius

type Rgb = [number, number, number]

interface Body {
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

interface Orb extends Body {
  site: Site
  rgb: Rgb
  glow: Rgb
  img: HTMLImageElement
  sprite: HTMLCanvasElement | null
  cruise: number
  fusing: Fusion | null
  hidden: boolean
  coolUntil: number
}

interface Fusion extends Body {
  a: Orb
  b: Orb
  phase: 'seek' | 'squash' | 'merged'
  t0: number
  /** contact normal, a → b */
  nx: number
  ny: number
  spin: number
}

interface Particle {
  kind: 'dust' | 'spark' | 'bit'
  x: number
  y: number
  vx: number
  vy: number
  size: number
  rgb: Rgb
  born: number
  life: number
  rot: number
  vr: number
  phase: number
}

interface Ring {
  x: number
  y: number
  r: number
  rgb: Rgb
  born: number
  delay: number
}

interface Blob {
  rgb: Rgb
  fx: number
  fy: number
  px: number
  py: number
  ax: number
  ay: number
  size: number
}

function rgbOf(hex: string): Rgb {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return [255, 255, 255]
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb
}

const css = ([r, g, b]: Rgb, a = 1) => `rgba(${r},${g},${b},${a})`
const lum = ([r, g, b]: Rgb) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

/** Brightened for glow when the brand is too dark to light anything (black brands glow cool white). */
function glowOf(rgb: Rgb): Rgb {
  const l = lum(rgb)
  if (l >= 0.25) return rgb
  if (Math.max(...rgb) - Math.min(...rgb) < 30) return [200, 210, 255]
  const k = 0.55 - l
  return rgb.map((c) => Math.round(c + (255 - c) * k)) as Rgb
}

function hueSat([r, g, b]: Rgb): [number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return [0, 0]
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, d / max]
}

/** Up to n saturated brand colors spread across the hue wheel, plus fallbacks if the set is dull. */
function palette(sites: Site[], n: number): Rgb[] {
  const colorful = sites
    .map((s) => rgbOf(s.color))
    .filter((c) => hueSat(c)[1] > 0.45 && lum(c) > 0.08)
    .sort((p, q) => hueSat(p)[0] - hueSat(q)[0])
  const fallback: Rgb[] = [[255, 90, 95], [88, 101, 242], [30, 215, 96], [162, 89, 255], [255, 184, 0]]
  if (colorful.length < n) return [...colorful, ...fallback].slice(0, n)
  return Array.from({ length: n }, (_, i) => colorful[Math.floor((i * colorful.length) / n)])
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const easeOutBack = (t: number) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2

export function startBackdrop(canvas: HTMLCanvasElement, sites: Site[]): { stop(): void } {
  const ctx = canvas.getContext('2d')!
  const blobCanvas = document.createElement('canvas')
  const bctx = blobCanvas.getContext('2d')!
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)')
  let reduced = motionQuery.matches

  let w = 0
  let h = 0
  let dpr = 1
  let raf = 0
  let last = 0
  let nextFusionAt = 0
  let stopped = false

  const blobs: Blob[] = palette(sites, 5).map((rgb, i) => ({
    rgb,
    fx: rand(0.03, 0.07) * (i % 2 ? 1 : -1),
    fy: rand(0.03, 0.06),
    px: rand(0, Math.PI * 2),
    py: rand(0, Math.PI * 2),
    ax: rand(0.25, 0.42),
    ay: rand(0.22, 0.38),
    size: rand(0.42, 0.6),
  }))
  const dustColors = blobs.map((b) => b.rgb).concat([[255, 255, 255]])

  const orbs: Orb[] = []
  const fusions: Fusion[] = []
  const particles: Particle[] = []
  const rings: Ring[] = []

  function makeOrbs() {
    orbs.length = 0
    if (!sites.length) return
    // one orb per site, never a repeat; a fused orb is just its two orbs, hidden until they split
    const unique = [...new Map(sites.map((s) => [s.id, s])).values()]
    const count = Math.min(unique.length, Math.max(7, Math.min(14, Math.round((w * h) / 90000))))
    const scale = Math.min(1, Math.max(0.65, Math.min(w, h) / 800))
    for (let i = 0; i < count; i++) {
      const site = unique[i]
      const rgb = rgbOf(site.color)
      const r = rand(24, 52) * scale
      let x = 0
      let y = 0
      for (let tries = 0; tries < 40; tries++) {
        x = rand(r, w - r)
        y = rand(r, h - r)
        if (orbs.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + r + 12)) break
      }
      const ang = rand(0, Math.PI * 2)
      const cruise = rand(18, 42)
      const img = logoImage(site)
      const orb: Orb = {
        site, rgb, glow: glowOf(rgb), img, sprite: null, r, x, y,
        vx: Math.cos(ang) * cruise, vy: Math.sin(ang) * cruise,
        cruise, fusing: null, hidden: false, coolUntil: 0,
      }
      img.addEventListener('load', () => { orb.sprite = null; if (reduced) drawStatic() }, { once: true })
      orbs.push(orb)
    }
  }

  function seedDust() {
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].kind === 'dust') particles.splice(i, 1)
    for (let i = 0; i < AMBIENT; i++) {
      particles.push({
        kind: 'dust', x: rand(0, w), y: rand(0, h), vx: rand(-8, 8), vy: rand(-14, -3),
        size: rand(0.8, 2.4), rgb: dustColors[i % dustColors.length],
        born: 0, life: Infinity, rot: 0, vr: rand(1.2, 3.2), phase: rand(0, Math.PI * 2),
      })
    }
  }

  /** Halo + brand disc + glyph + highlight, rendered once per orb at device resolution. */
  function spriteFor(o: Orb): HTMLCanvasElement {
    if (o.sprite) return o.sprite
    const R = SPRITE_R * dpr
    const size = Math.ceil(R * HALO * 2)
    const c = document.createElement('canvas')
    c.width = c.height = size
    const g = c.getContext('2d')!
    const m = size / 2
    const halo = g.createRadialGradient(m, m, R * 0.8, m, m, R * HALO)
    halo.addColorStop(0, css(o.glow, 0.55))
    halo.addColorStop(1, css(o.glow, 0))
    g.fillStyle = halo
    g.fillRect(0, 0, size, size)
    g.fillStyle = o.site.logoUrl ? (o.site.logoBg ?? '#ffffff') : o.site.color
    g.beginPath()
    g.arc(m, m, R, 0, Math.PI * 2)
    g.fill()
    const img = o.img
    if (img.complete && img.naturalWidth > 0) {
      const box = R * 1.1
      const k = box / Math.max(img.naturalWidth, img.naturalHeight)
      g.drawImage(img, m - (img.naturalWidth * k) / 2, m - (img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k)
      o.sprite = c // only cache once the glyph is in
    }
    const shine = g.createRadialGradient(m - R * 0.4, m - R * 0.45, 0, m - R * 0.4, m - R * 0.45, R * 1.1)
    shine.addColorStop(0, 'rgba(255,255,255,0.32)')
    shine.addColorStop(0.5, 'rgba(255,255,255,0.05)')
    shine.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = shine
    g.beginPath()
    g.arc(m, m, R, 0, Math.PI * 2)
    g.fill()
    g.lineWidth = Math.max(1, R * 0.05)
    g.strokeStyle = css(o.glow, 0.7)
    g.stroke()
    return c
  }

  function resize() {
    const prevDpr = dpr
    dpr = Math.min(devicePixelRatio || 1, 2)
    const nw = canvas.clientWidth || innerWidth
    const nh = canvas.clientHeight || innerHeight
    const first = w === 0
    w = nw
    h = nh
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    blobCanvas.width = Math.max(1, Math.round(w * BLOB_SCALE))
    blobCanvas.height = Math.max(1, Math.round(h * BLOB_SCALE))
    if (dpr !== prevDpr) for (const o of orbs) o.sprite = null
    if (first) {
      makeOrbs()
      seedDust()
    } else {
      for (const o of orbs) {
        o.x = Math.min(Math.max(o.x, o.r), w - o.r)
        o.y = Math.min(Math.max(o.y, o.r), h - o.r)
      }
    }
    if (reduced) drawStatic()
  }

  // ---------- particles ----------

  function emit(p: Omit<Particle, 'born' | 'phase'>, now: number) {
    if (particles.length >= MAX_PARTICLES) return
    particles.push({ ...p, born: now, phase: 0 })
  }

  function sparks(x: number, y: number, nx: number, ny: number, a: Rgb, b: Rgb, n: number, speed: number, now: number) {
    for (let i = 0; i < n; i++) {
      // fan out sideways from the contact, like metal on metal
      const side = i % 2 ? 1 : -1
      const spread = rand(-0.9, 0.9)
      const dx = -ny * side + nx * spread
      const dy = nx * side + ny * spread
      const len = Math.hypot(dx, dy) || 1
      const v = speed * rand(0.5, 1.2)
      emit({ kind: 'spark', x, y, vx: (dx / len) * v, vy: (dy / len) * v, size: rand(1.2, 2.4), rgb: i % 2 ? a : b, life: rand(350, 650), rot: 0, vr: 0 }, now)
    }
  }

  function confetti(x: number, y: number, R: number, a: Rgb, b: Rgb, n: number, now: number) {
    for (let i = 0; i < n; i++) {
      const ang = rand(0, Math.PI * 2)
      const v = R * rand(2.2, 5)
      emit({
        kind: 'bit', x: x + Math.cos(ang) * R * 0.4, y: y + Math.sin(ang) * R * 0.4,
        vx: Math.cos(ang) * v, vy: Math.sin(ang) * v - R * 1.2,
        size: rand(4, 9), rgb: i % 3 === 2 ? [255, 255, 255] : i % 2 ? a : b,
        life: rand(1000, 1500), rot: rand(0, Math.PI), vr: rand(-12, 12),
      }, now)
    }
  }

  // ---------- simulation ----------

  function bodies(): Body[] {
    const list: Body[] = []
    for (const o of orbs) if (!o.hidden && (!o.fusing || o.fusing.phase === 'seek')) list.push(o)
    for (const f of fusions) if (f.phase === 'merged') list.push(f)
    return list
  }

  function pairOf(p: Body, q: Body): Fusion | null {
    const f = (p as Orb).fusing
    return f && f.phase === 'seek' && f === (q as Orb).fusing ? f : null
  }

  function collide(now: number) {
    const list = bodies()
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const p = list[i]
        const q = list[j]
        if (pairOf(p, q)) continue // the fusing pair meets on purpose
        const dx = q.x - p.x
        const dy = q.y - p.y
        const dist = Math.hypot(dx, dy)
        const min = p.r + q.r
        if (dist >= min || dist === 0) continue
        const nx = dx / dist
        const ny = dy / dist
        const mp = p.r * p.r
        const mq = q.r * q.r
        // separate
        const push = min - dist
        p.x -= nx * push * (mq / (mp + mq))
        p.y -= ny * push * (mq / (mp + mq))
        q.x += nx * push * (mp / (mp + mq))
        q.y += ny * push * (mp / (mp + mq))
        // elastic exchange along the normal
        const rel = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny
        if (rel >= 0) continue
        const imp = (2 * rel) / (mp + mq)
        p.vx += imp * mq * nx
        p.vy += imp * mq * ny
        q.vx -= imp * mp * nx
        q.vy -= imp * mp * ny
        if (rel < -12) {
          const cx = p.x + nx * p.r
          const cy = p.y + ny * p.r
          sparks(cx, cy, nx, ny, colorOf(p, 0), colorOf(q, 1), 6, 120 + Math.min(200, -rel * 2), now)
        }
      }
    }
  }

  function colorOf(b: Body, side: 0 | 1): Rgb {
    if ('site' in b) return (b as Orb).glow
    const f = b as Fusion
    return side ? f.b.glow : f.a.glow
  }

  function walls(b: Body) {
    if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) }
    if (b.x > w - b.r) { b.x = w - b.r; b.vx = -Math.abs(b.vx) }
    if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) }
    if (b.y > h - b.r) { b.y = h - b.r; b.vy = -Math.abs(b.vy) }
  }

  /** A soft field around the title and panel: free orbs drift around it, so the copy stays readable. */
  function keepOut(o: Orb, dt: number) {
    const ex = Math.min(w * 0.36, 460) + o.r
    const ey = Math.min(h * 0.2, 190) + o.r
    const dx = (o.x - w / 2) / ex
    const dy = (o.y - h * 0.47) / ey
    const d = Math.hypot(dx, dy)
    if (d >= 1) return
    const f = 140 * (1 - d) * dt
    const n = d || 1
    o.vx += (dx / n) * f
    o.vy += (dy / n) * f
  }

  function startFusion(now: number) {
    const free = orbs.filter((o) => !o.fusing && !o.hidden && o.coolUntil < now)
    if (free.length < 2) return
    const a = free[Math.floor(Math.random() * free.length)]
    let b: Orb | null = null
    let best = Infinity
    for (const o of free) {
      if (o === a || o.site.id === a.site.id) continue
      // nearest-ish, with a little randomness so the same neighbours don't always pair up
      const d = Math.hypot(o.x - a.x, o.y - a.y) * rand(0.7, 1.3)
      if (d < best) { best = d; b = o }
    }
    if (!b) return
    const f: Fusion = { a, b, phase: 'seek', t0: now, nx: 0, ny: 0, spin: rand(0, Math.PI * 2), x: 0, y: 0, vx: 0, vy: 0, r: 0 }
    a.fusing = b.fusing = f
    fusions.push(f)
  }

  function endFusion(f: Fusion, now: number) {
    fusions.splice(fusions.indexOf(f), 1)
    for (const o of [f.a, f.b]) {
      o.fusing = null
      o.hidden = false
      o.coolUntil = now + COOLDOWN_MS
    }
  }

  function stepFusion(f: Fusion, now: number, dt: number) {
    const { a, b } = f
    if (f.phase === 'seek') {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.hypot(dx, dy) || 1
      const nx = dx / dist
      const ny = dy / dist
      const acc = 320 * dt
      a.vx += nx * acc
      a.vy += ny * acc
      b.vx -= nx * acc
      b.vy -= ny * acc
      if (dist <= a.r + b.r) {
        f.phase = 'squash'
        f.t0 = now
        f.nx = nx
        f.ny = ny
        sparks(a.x + nx * a.r, a.y + ny * a.r, nx, ny, a.glow, b.glow, 10, 220, now)
      } else if (now - f.t0 > SEEK_TIMEOUT_MS) {
        endFusion(f, now)
      }
      return
    }
    if (f.phase === 'squash') {
      const k = (now - f.t0) / SQUASH_MS
      // pressed together: momentum bleeds off, the pair keeps touching and drifts as one
      for (const o of [a, b]) {
        o.vx *= Math.exp(-dt * 10)
        o.vy *= Math.exp(-dt * 10)
      }
      const mx = (a.x * a.r * a.r + b.x * b.r * b.r) / (a.r * a.r + b.r * b.r)
      const my = (a.y * a.r * a.r + b.y * b.r * b.r) / (a.r * a.r + b.r * b.r)
      const overlap = 0.12 * Math.min(1, k)
      const span = a.r + b.r
      const ta = (span * (b.r * b.r)) / (a.r * a.r + b.r * b.r)
      a.x = mx - f.nx * ta * (1 - overlap)
      a.y = my - f.ny * ta * (1 - overlap)
      b.x = mx + f.nx * (span - ta) * (1 - overlap)
      b.y = my + f.ny * (span - ta) * (1 - overlap)
      if (Math.random() < 0.6) {
        const cx = a.x + f.nx * a.r * (1 - overlap)
        const cy = a.y + f.ny * a.r * (1 - overlap)
        sparks(cx, cy, f.nx, f.ny, a.glow, b.glow, 2, 160 + 160 * k, now)
      }
      if (k >= 1) {
        f.phase = 'merged'
        f.t0 = now
        f.x = mx
        f.y = my
        f.vx = (a.vx * a.r * a.r + b.vx * b.r * b.r) / (a.r * a.r + b.r * b.r) + rand(-20, 20)
        f.vy = (a.vy * a.r * a.r + b.vy * b.r * b.r) / (a.r * a.r + b.r * b.r) + rand(-20, 20)
        f.r = Math.hypot(a.r, b.r) * 1.08
        a.hidden = b.hidden = true
        rings.push({ x: mx, y: my, r: f.r, rgb: a.glow, born: now, delay: 0 })
        rings.push({ x: mx, y: my, r: f.r, rgb: b.glow, born: now, delay: 120 })
        confetti(mx, my, f.r, a.glow, b.glow, 36, now)
      }
      return
    }
    // merged: drift (moved with the other bodies), then split apart along a fresh axis
    if (now - f.t0 >= MERGED_MS) {
      const ang = f.spin + rand(-0.6, 0.6)
      const nx = Math.cos(ang)
      const ny = Math.sin(ang)
      const out = 150
      a.x = f.x - nx * (a.r + 2)
      a.y = f.y - ny * (a.r + 2)
      b.x = f.x + nx * (b.r + 2)
      b.y = f.y + ny * (b.r + 2)
      a.vx = f.vx - nx * out
      a.vy = f.vy - ny * out
      b.vx = f.vx + nx * out
      b.vy = f.vy + ny * out
      for (const o of [a, b]) walls(o)
      sparks(f.x, f.y, nx, ny, a.glow, b.glow, 10, 200, now)
      rings.push({ x: f.x, y: f.y, r: f.r * 0.8, rgb: [255, 255, 255], born: now, delay: 0 })
      endFusion(f, now)
    }
  }

  function step(now: number, dt: number) {
    if (now >= nextFusionAt) {
      if (fusions.length < MAX_FUSIONS) startFusion(now)
      nextFusionAt = now + rand(2500, 4000)
    }
    for (const f of [...fusions]) stepFusion(f, now, dt)

    for (const o of orbs) {
      if (o.hidden || (o.fusing && o.fusing.phase === 'squash')) continue
      if (!o.fusing) {
        keepOut(o, dt)
        // ease back toward a lazy cruising speed after any kick
        const sp = Math.hypot(o.vx, o.vy) || 1
        const k = 1 + (o.cruise / sp - 1) * Math.min(1, dt * 0.8)
        o.vx *= k
        o.vy *= k
      } else {
        const sp = Math.hypot(o.vx, o.vy)
        if (sp > 280) { o.vx *= 280 / sp; o.vy *= 280 / sp }
      }
      o.x += o.vx * dt
      o.y += o.vy * dt
      walls(o)
    }
    for (const f of fusions) {
      if (f.phase !== 'merged') continue
      f.vx *= Math.exp(-dt * 0.6)
      f.vy *= Math.exp(-dt * 0.6)
      f.x += f.vx * dt
      f.y += f.vy * dt
      walls(f)
    }
    collide(now)

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]
      if (p.kind === 'dust') {
        p.x += p.vx * dt
        p.y += p.vy * dt
        if (p.y < -4) { p.y = h + 4; p.x = rand(0, w) }
        if (p.x < -4) p.x = w + 4
        if (p.x > w + 4) p.x = -4
        continue
      }
      if (now - p.born > p.life) { particles.splice(i, 1); continue }
      const drag = Math.exp(-dt * (p.kind === 'spark' ? 3.5 : 1.8))
      p.vx *= drag
      p.vy = p.vy * drag + (p.kind === 'bit' ? 260 : 40) * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.vr * dt
    }
    for (let i = rings.length - 1; i >= 0; i--) if (now - rings[i].born - rings[i].delay > 750) rings.splice(i, 1)
  }

  // ---------- drawing ----------

  function drawBlobs(t: number) {
    const bw = blobCanvas.width
    const bh = blobCanvas.height
    bctx.globalCompositeOperation = 'source-over'
    bctx.fillStyle = '#0d0b1a'
    bctx.fillRect(0, 0, bw, bh)
    bctx.globalCompositeOperation = 'lighter'
    const big = Math.max(bw, bh)
    for (const b of blobs) {
      const x = bw * (0.5 + b.ax * Math.sin(t * b.fx * Math.PI * 2 + b.px))
      const y = bh * (0.5 + b.ay * Math.cos(t * b.fy * Math.PI * 2 + b.py))
      const r = big * b.size
      const g = bctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, css(b.rgb, 0.5))
      g.addColorStop(0.45, css(b.rgb, 0.18))
      g.addColorStop(1, css(b.rgb, 0))
      bctx.fillStyle = g
      bctx.fillRect(0, 0, bw, bh)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(blobCanvas, 0, 0, canvas.width, canvas.height)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // a gentle vignette keeps the edges deep and the colour in the middle
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.62)
    v.addColorStop(0, 'rgba(6,5,14,0)')
    v.addColorStop(1, 'rgba(6,5,14,0.55)')
    ctx.fillStyle = v
    ctx.fillRect(0, 0, w, h)
  }

  function drawDust(now: number) {
    ctx.globalCompositeOperation = 'lighter'
    for (const p of particles) {
      if (p.kind !== 'dust') continue
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now * 0.001 * p.vr + p.phase))
      ctx.fillStyle = css(p.rgb, 0.12 * tw)
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * 3.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = css(p.rgb, 0.85 * tw)
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  function drawOrb(o: Orb, sx = 1, sy = 1, ang = 0) {
    const s = spriteFor(o)
    const d = o.r * HALO * 2
    if (sx === 1 && sy === 1) {
      ctx.drawImage(s, o.x - d / 2, o.y - d / 2, d, d)
      return
    }
    ctx.save()
    ctx.translate(o.x, o.y)
    ctx.rotate(ang)
    ctx.scale(sx, sy)
    ctx.drawImage(s, -d / 2, -d / 2, d, d)
    ctx.restore()
  }

  function drawSquash(f: Fusion, now: number) {
    const k = Math.min(1, (now - f.t0) / SQUASH_MS)
    const ang = Math.atan2(f.ny, f.nx)
    const press = Math.sin(k * Math.PI * 0.5)
    const jit = 2.2 * press
    for (const o of [f.a, f.b]) {
      const ox = o.x
      const oy = o.y
      o.x += rand(-jit, jit)
      o.y += rand(-jit, jit)
      drawOrb(o, 1 - 0.16 * press, 1 + 0.1 * press, ang)
      o.x = ox
      o.y = oy
    }
    // seam glow where they press together
    const cx = f.a.x + f.nx * f.a.r * (1 - 0.12 * k)
    const cy = f.a.y + f.ny * f.a.r * (1 - 0.12 * k)
    const gr = Math.min(f.a.r, f.b.r) * (0.6 + 0.8 * k)
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, gr)
    g.addColorStop(0, `rgba(255,255,255,${0.9 * press})`)
    g.addColorStop(0.35, css(f.a.glow, 0.45 * press))
    g.addColorStop(1, css(f.b.glow, 0))
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, gr, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
  }

  function drawGlyph(img: HTMLImageElement, x: number, y: number, box: number, alpha: number) {
    if (!img.complete || img.naturalWidth === 0) return
    const k = box / Math.max(img.naturalWidth, img.naturalHeight)
    ctx.globalAlpha = alpha
    ctx.drawImage(img, x - (img.naturalWidth * k) / 2, y - (img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k)
    ctx.globalAlpha = 1
  }

  function drawMerged(f: Fusion, now: number, motion: boolean) {
    const t = (now - f.t0) / 1000
    const grow = motion ? Math.min(1, (now - f.t0) / GROW_MS) : 1
    const R = f.r * easeOutBack(grow) * (1 + (motion ? 0.045 * Math.sin(t * 7) : 0))
    const { a, b } = f
    const axis = f.spin + (motion ? t * 0.5 : 0)
    const nx = Math.cos(axis)
    const ny = Math.sin(axis)

    // twin halo, one per brand, offset to its own half
    ctx.globalCompositeOperation = 'lighter'
    for (const [o, side] of [[a, -1], [b, 1]] as const) {
      const hx = f.x + nx * side * R * 0.3
      const hy = f.y + ny * side * R * 0.3
      const g = ctx.createRadialGradient(hx, hy, R * 0.6, hx, hy, R * 1.9)
      g.addColorStop(0, css(o.glow, 0.5))
      g.addColorStop(1, css(o.glow, 0))
      ctx.fillStyle = g
      ctx.fillRect(hx - R * 2, hy - R * 2, R * 4, R * 4)
    }
    ctx.globalCompositeOperation = 'source-over'

    // A | B split disc
    ctx.save()
    ctx.beginPath()
    ctx.arc(f.x, f.y, R, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = a.site.color
    ctx.fillRect(f.x - R, f.y - R, R * 2, R * 2)
    ctx.translate(f.x, f.y)
    ctx.rotate(axis)
    ctx.fillStyle = b.site.color
    ctx.fillRect(0, -R, R, R * 2)
    // hot seam
    const seam = ctx.createLinearGradient(-R * 0.18, 0, R * 0.18, 0)
    seam.addColorStop(0, 'rgba(255,255,255,0)')
    seam.addColorStop(0.5, 'rgba(255,255,255,0.75)')
    seam.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = seam
    ctx.fillRect(-R * 0.18, -R, R * 0.36, R * 2)
    ctx.globalCompositeOperation = 'source-over'
    ctx.rotate(-axis)
    // both glyphs overlapped, each nudged toward its own half
    drawGlyph(a.img, -nx * R * 0.14, -ny * R * 0.14, R * 0.95, 0.92)
    drawGlyph(b.img, nx * R * 0.14, ny * R * 0.14, R * 0.95, 0.92)
    const shine = ctx.createRadialGradient(-R * 0.4, -R * 0.45, 0, -R * 0.4, -R * 0.45, R * 1.1)
    shine.addColorStop(0, 'rgba(255,255,255,0.3)')
    shine.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = shine
    ctx.fillRect(-R, -R, R * 2, R * 2)
    ctx.restore()

    // turning dashed energy ring, A → B
    ctx.save()
    const ring = ctx.createLinearGradient(f.x - nx * R, f.y - ny * R, f.x + nx * R, f.y + ny * R)
    ring.addColorStop(0, css(a.glow, 0.95))
    ring.addColorStop(1, css(b.glow, 0.95))
    ctx.strokeStyle = ring
    ctx.lineWidth = 3
    ctx.setLineDash([R * 0.35, R * 0.18])
    ctx.lineDashOffset = motion ? -t * 60 : 0
    ctx.beginPath()
    ctx.arc(f.x, f.y, R * 1.12, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()

    // flash at the moment of fusion
    const since = now - f.t0
    if (motion && since < 260) {
      ctx.globalAlpha = 0.9 * (1 - since / 260)
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(f.x, f.y, R * 1.15, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }

  function drawFx(now: number) {
    for (const r of rings) {
      const k = (now - r.born - r.delay) / 700
      if (k <= 0 || k >= 1) continue
      const e = 1 - (1 - k) ** 3
      ctx.globalAlpha = 1 - k
      ctx.strokeStyle = css(r.rgb)
      ctx.lineWidth = 10 * (1 - e) + 1
      ctx.beginPath()
      ctx.arc(r.x, r.y, r.r * (1 + 1.8 * e), 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    for (const p of particles) {
      if (p.kind === 'dust') continue
      const life = (now - p.born) / p.life
      if (p.kind === 'spark') {
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 1 - life
        ctx.strokeStyle = css(p.rgb)
        ctx.lineWidth = p.size
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04)
        ctx.stroke()
        ctx.globalCompositeOperation = 'source-over'
      } else {
        ctx.globalAlpha = life < 0.66 ? 1 : (1 - life) / 0.34
        const cos = Math.cos(p.rot)
        const sin = Math.sin(p.rot)
        ctx.setTransform(dpr * cos, dpr * sin, -dpr * sin, dpr * cos, dpr * p.x, dpr * p.y)
        ctx.fillStyle = css(p.rgb)
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
    }
    ctx.globalAlpha = 1
  }

  function draw(now: number, motion: boolean) {
    drawBlobs(now / 1000)
    drawDust(now)
    for (const o of orbs) if (!o.hidden && !(o.fusing && o.fusing.phase === 'squash')) drawOrb(o)
    for (const f of fusions) {
      if (f.phase === 'squash') drawSquash(f, now)
      else if (f.phase === 'merged') drawMerged(f, now, motion)
    }
    drawFx(now)
  }

  /** Reduced motion: one composed frame, with one pair already fused for the idea. */
  function drawStatic() {
    if (stopped) return
    if (!fusions.length && orbs.length >= 2) {
      const a = orbs[0]
      const b = orbs.find((o) => o.site.id !== a.site.id)
      if (b) {
        a.hidden = b.hidden = true
        const f: Fusion = {
          a, b, phase: 'merged', t0: 0, nx: 0, ny: 0, spin: -0.4,
          x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, vx: 0, vy: 0, r: Math.hypot(a.r, b.r) * 1.08,
        }
        a.fusing = b.fusing = f
        fusions.push(f)
        walls(f)
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw(4000, false)
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    step(now, dt)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw(now, true)
  }

  function play() {
    cancelAnimationFrame(raf)
    raf = 0
    if (stopped || document.hidden) return
    if (reduced) {
      drawStatic()
      return
    }
    last = performance.now()
    if (!nextFusionAt) nextFusionAt = last + 1200 // first fusion early, so visitors see it
    raf = requestAnimationFrame(frame)
  }

  function onMotionChange() {
    reduced = motionQuery.matches
    for (const f of [...fusions]) endFusion(f, 0)
    particles.length = 0
    rings.length = 0
    seedDust()
    play()
  }

  const onVisibility = () => play()
  addEventListener('resize', resize)
  document.addEventListener('visibilitychange', onVisibility)
  motionQuery.addEventListener('change', onMotionChange)
  resize()
  play()

  return {
    stop() {
      stopped = true
      cancelAnimationFrame(raf)
      removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
      motionQuery.removeEventListener('change', onMotionChange)
    },
  }
}
