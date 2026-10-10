import { sameRef, type Collision, type FuseState, type Held, type ItemRef, type Scene } from '../scene/Scene'
import { coverRect } from '../tracking/coords'
import type { Point, Site, TrackedHand } from '../types'
import { logoImage } from './logoImages'

const SPARKS = 80
const SPARK_SPAWN = 1.6
const TAIL = 10
const CONFETTI = 60
const BURST_MS = 1200
const FLASH_MS = 250
const REVEAL_DELAY_MS = 120
const REVEAL_MS = 400
/** collision: max live seam sparks */
const SEAM_SPARKS = 80
/** collision: screen shake starts at this charge */
const SHAKE_FROM = 0.8

interface Spark {
  ang: number
  rad: number
  speed: number
  spin: number
  size: number
  c: 0 | 1
}

interface Bit {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
  w: number
  h: number
  c: 0 | 1
}

/** A short-lived spark thrown out of the seam between two pressed logos. */
interface SeamSpark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  c: 0 | 1
}

/** Effect state for the current fuse attempt (keyed by fuse id). */
interface FuseFx {
  id: number
  colors: [string, string]
  sparks: Spark[]
  bits: Bit[]
  burstAt: number
  revealAt: number
  lastNow: number
}

function respawnSpark(s: Spark, R: number): void {
  s.ang = Math.random() * Math.PI * 2
  s.rad = R * (SPARK_SPAWN + Math.random() * 0.2)
  s.speed = R * (0.45 + Math.random() * 0.45)
  s.spin = 0.9 + Math.random() * 1.2
  s.size = 1.5 + Math.random() * 2
}

/** Brand color brightened if it is too dark to glow (e.g. black brands). */
function vivid(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return '#ffffff'
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const lum = (0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]) / 255
  if (lum >= 0.25) return hex
  const k = 0.55 - lum
  const mixed = ch.map((c) => Math.round(c + (255 - c) * k))
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** Draws a Scene onto a canvas. Reads the scene; never changes it. */
export class Renderer {
  showDebug = false
  private ctx: CanvasRenderingContext2D
  private glyphs = new Map<string, HTMLImageElement>()
  private results = new Map<string, HTMLImageElement>()
  private fx: FuseFx = { id: -1, colors: ['#ffffff', '#ffffff'], sparks: [], bits: [], burstAt: -1, revealAt: -1, lastNow: 0 }
  private tmp: Point = { x: 0, y: 0 }
  private dpr = 1
  private reducedMotion = false
  private seam: SeamSpark[] = []
  private seamLastNow = 0

  constructor(
    private canvas: HTMLCanvasElement,
    sites: Site[],
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas unavailable')
    this.ctx = ctx
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (mq) {
      this.reducedMotion = mq.matches
      mq.addEventListener('change', (e) => (this.reducedMotion = e.matches))
    }
    for (const s of sites) this.glyphs.set(s.id, logoImage(s))
  }

  /** Registers a site added at runtime (your sites). */
  addSite(site: Site): void {
    this.glyphs.set(site.id, logoImage(site))
  }

  resize(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1
    this.dpr = dpr
    this.canvas.width = Math.round(width * dpr)
    this.canvas.height = Math.round(height * dpr)
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  draw(scene: Scene, video: HTMLVideoElement | null, hands: TrackedHand[]): void {
    const { ctx } = this
    const { width: W, height: H } = scene.layout
    ctx.fillStyle = '#0b0b10'
    ctx.fillRect(0, 0, W, H)

    // near full charge the whole frame shakes
    const col = scene.collision
    const shake = !this.reducedMotion && col && col.charge > SHAKE_FROM ? (6 * (col.charge - SHAKE_FROM)) / (1 - SHAKE_FROM) : 0
    ctx.save()
    if (shake) ctx.translate((Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake)

    if (video && video.readyState >= 2) {
      const r = coverRect(video.videoWidth, video.videoHeight, W, H)
      ctx.save()
      ctx.translate(W, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(video, r.x, r.y, r.w, r.h)
      ctx.restore()
      ctx.fillStyle = 'rgba(8, 8, 14, 0.4)'
      ctx.fillRect(0, 0, W, H)
    }

    this.drawShelves(scene)
    this.drawSlots(scene)
    this.drawFlights(scene)
    this.drawHeld(scene)
    this.drawCollision(scene)
    this.drawCardZones(scene)
    this.drawFuse(scene)
    this.drawCursors(scene)
    ctx.restore()
    if (this.showDebug) this.drawLandmarks(hands)
  }

  private hovered(scene: Scene, ref: ItemRef): boolean {
    for (const h of scene.hover.values()) if (sameRef(h, ref)) return true
    return false
  }

  private drawLogo(site: Site, p: Point, r: number, glow = false, alpha = 1): void {
    const { ctx } = this
    const img = this.glyphs.get(site.id)
    const ready = img !== undefined && img.complete && img.naturalWidth > 0
    ctx.save()
    ctx.globalAlpha = alpha
    if (glow) {
      ctx.shadowColor = 'rgba(255, 255, 255, 0.9)'
      ctx.shadowBlur = r * 0.8
    }
    // your sites: full-color logo on white; reference sites: white/black glyph on brand color
    ctx.fillStyle = site.logoUrl ? (site.logoBg ?? '#ffffff') : site.color
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    if (ready) {
      const box = site.logoUrl ? r * 1.3 : r * 1.1
      const k = box / Math.max(img.naturalWidth, img.naturalHeight)
      const w = img.naturalWidth * k
      const h = img.naturalHeight * k
      ctx.clip()
      ctx.drawImage(img, p.x - w / 2, p.y - h / 2, w, h)
    }
    ctx.restore()
  }

  private drawShelves(scene: Scene): void {
    const L = scene.layout
    for (const side of ['left', 'right'] as const) {
      scene.shelves[side].forEach((id, index) => {
        const glow = !scene.fuse && this.hovered(scene, { kind: 'shelf', side, index })
        this.drawLogo(scene.site(id), L.shelf[side][index], L.shelfRadius, glow, scene.fuse ? 0.35 : 1)
      })
    }
  }

  private drawSlots(scene: Scene): void {
    if (scene.fuse) return
    const { ctx } = this
    const L = scene.layout
    for (const slot of [0, 1] as const) {
      const p = L.slots[slot]
      ctx.save()
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
      ctx.setLineDash([8, 10])
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(p.x, p.y, L.slotRadius + 10, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
      if (!scene.isSlotHidden(slot)) {
        this.drawLogo(scene.site(scene.slots[slot]), p, L.slotRadius, this.hovered(scene, { kind: 'slot', slot }))
      }
    }
  }

  private drawFlights(scene: Scene): void {
    for (const f of scene.flights) {
      const t = scene.flightProgress(f)
      const p = { x: f.from.x + (f.to.x - f.from.x) * t, y: f.from.y + (f.to.y - f.from.y) * t }
      this.drawLogo(scene.site(f.siteId), p, f.fromRadius + (f.toRadius - f.fromRadius) * t)
    }
  }

  private drawHeld(scene: Scene): void {
    const col = scene.collision
    for (const h of scene.held.values()) {
      if (!h.siteId) continue
      if (col && h.from.kind === 'slot' && !this.reducedMotion) this.drawPressed(scene, h, col)
      else this.drawLogo(scene.site(h.siteId), h.pos, scene.heldRadius(h), true)
    }
  }

  /** A held slot logo pressed against the other: flattened at the seam and trembling with charge. */
  private drawPressed(scene: Scene, h: Held, col: Collision): void {
    const { ctx } = this
    const r = scene.heldRadius(h)
    const { axis, push, charge } = col
    // which way the seam is from this logo
    const side = (col.point.x - h.pos.x) * axis.x + (col.point.y - h.pos.y) * axis.y >= 0 ? 1 : -1
    const jx = (Math.random() * 2 - 1) * 4 * charge
    const jy = (Math.random() * 2 - 1) * 4 * charge
    const p = { x: h.pos.x + jx, y: h.pos.y + jy }
    // scale about the contact edge so the logo flattens against the seam rather than shrinking away from it
    const ax = p.x + axis.x * side * r
    const ay = p.y + axis.y * side * r
    const ang = Math.atan2(axis.y, axis.x)
    ctx.save()
    ctx.translate(ax, ay)
    ctx.rotate(ang)
    ctx.scale(1 - 0.18 * push, 1 + 0.08 * push)
    ctx.rotate(-ang)
    ctx.translate(-ax, -ay)
    this.drawLogo(scene.site(h.siteId as string), p, r, true)
    ctx.restore()
  }

  /** Collision fx: seam glow and sparks, the charge ring, and a nudge while the push is too light. */
  private drawCollision(scene: Scene): void {
    const { ctx } = this
    const col = scene.collision
    const now = scene.now
    const dt = this.seamLastNow ? Math.min((now - this.seamLastNow) / 1000, 0.05) : 0
    this.seamLastNow = now
    const motion = !this.reducedMotion
    const sparks = this.seam
    if (!col && !sparks.length) return

    const ca = vivid(scene.site(scene.slots[0]).color)
    const cb = vivid(scene.site(scene.slots[1]).color)
    const R = scene.layout.slotRadius

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    if (col && motion && col.push > 0) {
      // seam glow: a hot spot that grows with the push and brightens with the charge
      const gr = R * (0.35 + 0.5 * col.push)
      const g = ctx.createRadialGradient(col.point.x, col.point.y, 0, col.point.x, col.point.y, gr)
      g.addColorStop(0, `rgba(255, 255, 255, ${0.35 + 0.5 * col.charge})`)
      g.addColorStop(1, 'rgba(255, 255, 255, 0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(col.point.x, col.point.y, gr, 0, Math.PI * 2)
      ctx.fill()

      // sparks squeezed out of the seam, roughly perpendicular to the push
      const n = Math.round(col.push * 6)
      const nx = -col.axis.y
      const ny = col.axis.x
      for (let i = 0; i < n && sparks.length < SEAM_SPARKS; i++) {
        const dir = Math.random() < 0.5 ? -1 : 1
        const spread = (Math.random() * 2 - 1) * 0.6
        const speed = R * (2 + Math.random() * 3) * (0.6 + 0.6 * col.charge)
        const vx = (nx * dir + col.axis.x * spread) * speed
        const vy = (ny * dir + col.axis.y * spread) * speed
        const along = (Math.random() * 2 - 1) * R * 0.25
        const max = 0.18 + Math.random() * 0.25
        sparks.push({
          x: col.point.x + nx * along,
          y: col.point.y + ny * along,
          vx,
          vy,
          life: max,
          max,
          size: 1.2 + Math.random() * 1.8,
          c: (i % 2) as 0 | 1,
        })
      }
    }
    if (!motion) sparks.length = 0

    // sparks: streaks along their velocity, slowed by drag, falling a little, fading out
    ctx.lineCap = 'round'
    const drag = Math.exp(-dt * 4)
    let live = 0
    for (const s of sparks) {
      s.life -= dt
      if (s.life <= 0) continue
      s.vx *= drag
      s.vy = s.vy * drag + R * 3 * dt
      s.x += s.vx * dt
      s.y += s.vy * dt
      const k = s.life / s.max
      ctx.globalAlpha = k
      ctx.strokeStyle = s.c === 0 ? ca : cb
      ctx.lineWidth = s.size
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      ctx.lineTo(s.x - s.vx * 0.03, s.y - s.vy * 0.03)
      ctx.stroke()
      sparks[live++] = s
    }
    sparks.length = live
    ctx.restore()

    if (!col) return
    const { point: p, axis, charge } = col
    const rr = R * 0.5

    // charge ring: faint full track, then the A → B sweep, thicker and hotter as it fills
    ctx.save()
    ctx.lineCap = 'round'
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(p.x, p.y, rr, 0, Math.PI * 2)
    ctx.stroke()
    if (charge > 0) {
      const g = ctx.createLinearGradient(p.x - axis.x * rr, p.y - axis.y * rr, p.x + axis.x * rr, p.y + axis.y * rr)
      g.addColorStop(0, ca)
      g.addColorStop(1, cb)
      ctx.strokeStyle = g
      ctx.lineWidth = 3 + 6 * charge
      ctx.shadowColor = 'rgba(255, 255, 255, 0.9)'
      ctx.shadowBlur = 18 * charge
      ctx.beginPath()
      ctx.arc(p.x, p.y, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * charge)
      ctx.stroke()
    }
    ctx.restore()

    if (col.push > 0 && charge < 0.3) {
      ctx.save()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.font = '700 18px system-ui, sans-serif'
      ctx.fillStyle = `rgba(255, 255, 255, ${0.9 * (1 - charge / 0.3) + 0.1})`
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
      ctx.shadowBlur = 6
      ctx.fillText('push harder!', p.x, p.y + scene.layout.slotRadius * 1.25 + 8)
      ctx.restore()
    }
  }

  private drawCardZones(scene: Scene): void {
    if (!scene.fuse || !scene.isCardHeld()) return
    const { ctx } = this
    const { width: W, height: H } = scene.layout
    const { top, bottom } = scene.cardZones()
    const canOpen = scene.fuse.status === 'done'
    ctx.save()
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
    if (canOpen) ctx.fillRect(0, 0, W, top)
    ctx.fillRect(0, bottom, W, H - bottom)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.font = '600 18px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (canOpen) ctx.fillText('↑ open fused site', W / 2, top / 2)
    ctx.fillText('↓ dismiss', W / 2, bottom + (H - bottom) / 2)
    ctx.restore()
  }

  /** The fused logo image for a result URL, created once and cached. */
  private resultImage(url: string): HTMLImageElement {
    let img = this.results.get(url)
    if (!img) {
      img = new Image()
      img.src = url
      this.results.set(url, img)
    }
    return img
  }

  /**
   * Loads a fused logo; resolves true once it can be drawn, false if it failed or took
   * longer than `timeoutMs`. A failed image is forgotten so a retry loads it afresh.
   */
  async prepareResult(url: string, timeoutMs = 5000): Promise<boolean> {
    const img = this.resultImage(url)
    let timer: ReturnType<typeof setTimeout> | undefined
    const ok = await Promise.race([
      img.decode().then(
        () => img.naturalWidth > 0,
        () => false,
      ),
      new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), timeoutMs))),
    ])
    clearTimeout(timer)
    if (!ok && this.results.get(url) === img) this.results.delete(url)
    return ok
  }

  /** Particle state belongs to one fuse attempt; a new id starts fresh. */
  private fxFor(f: FuseState, a: Site, b: Site, R: number): FuseFx {
    const fx = this.fx
    if (fx.id !== f.id) {
      fx.id = f.id
      fx.colors[0] = vivid(a.color)
      fx.colors[1] = vivid(b.color)
      fx.burstAt = -1
      fx.revealAt = -1
      fx.bits.length = 0
      fx.sparks.length = 0
      fx.lastNow = 0
      for (let i = 0; i < SPARKS; i++) {
        const s: Spark = { ang: 0, rad: 0, speed: 0, spin: 0, size: 0, c: (i % 2) as 0 | 1 }
        respawnSpark(s, R)
        s.rad = R * (0.2 + Math.random() * 1.4) // start spread out, not as one ring
        fx.sparks.push(s)
      }
    }
    return fx
  }

  private drawFuse(scene: Scene): void {
    const f = scene.fuse
    if (!f) return
    const { ctx } = this
    const a = scene.site(f.siteA)
    const b = scene.site(f.siteB)
    const R = scene.layout.cardRadius
    const p = f.at
    const now = scene.now
    const age = now - f.startedAt
    const motion = !this.reducedMotion
    const fx = this.fxFor(f, a, b, R)
    const dt = fx.lastNow ? Math.min((now - fx.lastNow) / 1000, 0.05) : 0
    fx.lastNow = now
    const [ca, cb] = fx.colors
    const t = age / 1000

    if (motion && age < 600) {
      const k = age / 600
      ctx.save()
      ctx.strokeStyle = `rgba(255, 255, 255, ${1 - k})`
      ctx.lineWidth = 8 * (1 - k) + 1
      ctx.beginPath()
      ctx.arc(p.x, p.y, R * (0.5 + 1.5 * k), 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    // card base: A | B halves
    ctx.save()
    if (this.hovered(scene, { kind: 'card' })) {
      ctx.shadowColor = 'rgba(255, 255, 255, 0.9)'
      ctx.shadowBlur = R * 0.5
    }
    ctx.beginPath()
    ctx.arc(p.x, p.y, R, 0, Math.PI * 2)
    ctx.fillStyle = a.color
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.clip()
    ctx.fillStyle = b.color
    ctx.fillRect(p.x, p.y - R, R, R * 2)
    if (f.status === 'fusing') {
      // dim the halves so the energy reads as light
      ctx.fillStyle = 'rgba(8, 8, 18, 0.55)'
      ctx.fillRect(p.x - R, p.y - R, R * 2, R * 2)
    }
    ctx.restore()

    if (f.status === 'fusing') {
      if (motion) this.drawVortex(fx, a, b, p, R, t, dt)
      else {
        this.energyRing(p, R * 1.08, ca, cb, 0, 0, 0.8)
        this.drawLogo(a, { x: p.x - R * 0.25, y: p.y }, R * 0.4)
        this.drawLogo(b, { x: p.x + R * 0.25, y: p.y }, R * 0.4)
      }
    } else {
      this.energyRing(p, R * 1.08, ca, cb, motion ? t * 0.4 : 0, motion ? t * 12 : 0, 0.55)
      this.drawResult(scene, f, fx, a, b, p, R)
      if (motion && f.status === 'done' && f.doneAt !== undefined) this.drawBurst(fx, f.doneAt, now, p, R, dt)
    }

    const pageNote =
      f.pageStatus === 'capturing' || f.pageStatus === 'generating'
        ? ' · building site…'
        : f.pageStatus === 'ready'
          ? ' · site ready ✓'
          : ''
    const status =
      f.status === 'fusing'
        ? `fusing… ${Math.floor(age / 1000)}s`
        : f.status === 'error'
          ? 'failed — grip to retry · pull ↓ to dismiss'
          : 'pull ↑ to open · pull ↓ to dismiss'
    ctx.save()
    ctx.textAlign = 'center'
    ctx.fillStyle = '#ffffff'
    ctx.font = '600 22px system-ui, sans-serif'
    ctx.fillText(f.result?.label ?? `${a.name} × ${b.name}`, p.x, p.y + R + 36)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
    ctx.font = '14px system-ui, sans-serif'
    ctx.fillText(status + pageNote, p.x, p.y + R + 60)
    ctx.restore()
  }

  /** A slowly turning dashed ring, A → B gradient across it. */
  private energyRing(p: Point, r: number, ca: string, cb: string, turn: number, dash: number, alpha: number): void {
    const { ctx } = this
    const dx = Math.cos(turn) * r
    const dy = Math.sin(turn) * r
    const g = ctx.createLinearGradient(p.x - dx, p.y - dy, p.x + dx, p.y + dy)
    g.addColorStop(0, ca)
    g.addColorStop(1, cb)
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.strokeStyle = g
    ctx.lineWidth = 3
    ctx.setLineDash([r * 0.16, r * 0.09])
    ctx.lineDashOffset = -dash
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  /** Fusing: glowing core, inflowing sparks, two logos orbiting on a breathing spiral. */
  private drawVortex(fx: FuseFx, a: Site, b: Site, p: Point, R: number, t: number, dt: number): void {
    const { ctx } = this
    const [ca, cb] = fx.colors
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.2)

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    // core: white heart, A then B, fading out
    const core = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R * (0.6 + 0.15 * pulse))
    core.addColorStop(0, 'rgba(255, 255, 255, 0.95)')
    core.addColorStop(0.22, ca)
    core.addColorStop(0.6, cb)
    core.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.globalAlpha = 0.45 + 0.3 * pulse
    ctx.fillStyle = core
    ctx.beginPath()
    ctx.arc(p.x, p.y, R, 0, Math.PI * 2)
    ctx.fill()

    // inflow sparks: short streaks along their spiral
    ctx.lineCap = 'round'
    for (const s of fx.sparks) {
      s.rad -= s.speed * dt * (1.6 - s.rad / (SPARK_SPAWN * R))
      s.ang += s.spin * dt * Math.min(4, R / Math.max(s.rad, R * 0.15))
      if (s.rad < R * 0.12) respawnSpark(s, R)
      const fadeIn = Math.min(1, (SPARK_SPAWN * R - s.rad) / (R * 0.25))
      const fadeOut = Math.min(1, (s.rad - R * 0.12) / (R * 0.4))
      const alpha = Math.max(0, Math.min(fadeIn, fadeOut))
      if (alpha <= 0.01) continue
      const x = p.x + Math.cos(s.ang) * s.rad
      const y = p.y + Math.sin(s.ang) * s.rad
      // tail points back along the orbit, slightly outward
      const len = R * 0.12 * (0.5 + s.spin / 2)
      const tx = Math.sin(s.ang) * len + Math.cos(s.ang) * len * 0.4
      const ty = -Math.cos(s.ang) * len + Math.sin(s.ang) * len * 0.4
      ctx.globalAlpha = alpha
      ctx.strokeStyle = s.c === 0 ? ca : cb
      ctx.lineWidth = s.size
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + tx, y + ty)
      ctx.stroke()
    }
    ctx.restore()

    this.energyRing(p, R * 1.08, ca, cb, t * 0.9, t * 40, 0.85)
    this.energyRing(p, R * 1.2, cb, ca, -t * 0.6, -t * 25, 0.35)

    // two logos on a spiral; comet tails are past positions on the same curve
    const orbit = (time: number, phase: number, out: Point): Point => {
      const rr = R * (0.25 + 0.1 * Math.sin(time * 1.3))
      const ang = time * 2.4 + phase
      out.x = p.x + Math.cos(ang) * rr
      out.y = p.y + Math.sin(ang) * rr
      return out
    }
    const q = this.tmp
    const logoR = R * 0.36
    ctx.save()
    for (let k = TAIL; k >= 1; k--) {
      const fade = 1 - k / (TAIL + 1)
      ctx.globalAlpha = 0.4 * fade
      for (const side of [0, 1] as const) {
        orbit(t - k * 0.03, side * Math.PI, q)
        ctx.fillStyle = fx.colors[side]
        ctx.beginPath()
        ctx.arc(q.x, q.y, logoR * (0.35 + 0.55 * fade), 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
    this.drawLogo(a, orbit(t, 0, q), logoR)
    this.drawLogo(b, orbit(t, Math.PI, q), logoR)
  }

  /** Done / error: the fused logo (cross-fading in over the two small logos) or the pair. */
  private drawResult(scene: Scene, f: FuseState, fx: FuseFx, a: Site, b: Site, p: Point, R: number): void {
    const { ctx } = this
    const url = f.status === 'done' ? f.result?.logoUrl : undefined
    const img = url ? this.resultImage(url) : null
    const ready = img !== null && img.complete && img.naturalWidth > 0
    let alpha = 0
    if (ready) {
      if (fx.revealAt < 0) fx.revealAt = Math.max(scene.now, (f.doneAt ?? scene.now) + REVEAL_DELAY_MS)
      alpha = Math.max(0, Math.min(1, (scene.now - fx.revealAt) / REVEAL_MS))
    }
    if (alpha < 1) {
      this.drawLogo(a, { x: p.x - R * 0.25, y: p.y }, R * 0.45, false, 1 - alpha)
      this.drawLogo(b, { x: p.x + R * 0.25, y: p.y }, R * 0.45, false, 1 - alpha)
    }
    if (ready && alpha > 0) {
      // a small pop: 1.08 → 1 as it fades in
      const r = R * 0.9 * (this.reducedMotion ? 1 : 1 + 0.08 * (1 - alpha) ** 2)
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.clip()
      ctx.drawImage(img!, p.x - r, p.y - r, r * 2, r * 2)
      ctx.restore()
    }
  }

  /** Completion: white flash, double shockwave in A and B, confetti in both colors. */
  private drawBurst(fx: FuseFx, doneAt: number, now: number, p: Point, R: number, dt: number): void {
    const { ctx } = this
    const since = now - doneAt
    if (fx.burstAt !== doneAt) {
      fx.burstAt = doneAt
      fx.bits.length = 0
      if (since < BURST_MS) {
        for (let i = 0; i < CONFETTI; i++) {
          const ang = Math.random() * Math.PI * 2
          const speed = R * (2 + Math.random() * 3.5)
          fx.bits.push({
            x: p.x + Math.cos(ang) * R * 0.5,
            y: p.y + Math.sin(ang) * R * 0.5,
            vx: Math.cos(ang) * speed,
            vy: Math.sin(ang) * speed - R * 1.2,
            rot: Math.random() * Math.PI,
            vr: (Math.random() - 0.5) * 14,
            w: 4 + Math.random() * 6,
            h: 3 + Math.random() * 3,
            c: (i % 2) as 0 | 1,
          })
        }
      }
    }
    if (since > BURST_MS) {
      fx.bits.length = 0
      return
    }

    ctx.save()
    // shockwaves: A first, B right after
    for (let i = 0; i < 2; i++) {
      const k = (since - i * 120) / 700
      if (k <= 0 || k >= 1) continue
      const e = 1 - (1 - k) ** 3
      ctx.globalAlpha = 1 - k
      ctx.strokeStyle = fx.colors[i]
      ctx.lineWidth = 12 * (1 - e) + 1
      ctx.beginPath()
      ctx.arc(p.x, p.y, R * (1 + 1.8 * e), 0, Math.PI * 2)
      ctx.stroke()
    }

    // confetti: outward, slowed by drag, pulled down, fading over the last third
    const drag = Math.exp(-dt * 1.8)
    const life = since / BURST_MS
    ctx.globalAlpha = life < 0.66 ? 1 : (1 - life) / 0.34
    for (const c of fx.bits) {
      c.vx *= drag
      c.vy = c.vy * drag + R * 4 * dt
      c.x += c.vx * dt
      c.y += c.vy * dt
      c.rot += c.vr * dt
      const cos = Math.cos(c.rot)
      const sin = Math.sin(c.rot)
      ctx.setTransform(this.dpr * cos, this.dpr * sin, -this.dpr * sin, this.dpr * cos, this.dpr * c.x, this.dpr * c.y)
      ctx.fillStyle = fx.colors[c.c]
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h)
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)

    // flash: brightest at the moment of completion
    if (since < FLASH_MS) {
      ctx.globalAlpha = 0.9 * (1 - since / FLASH_MS)
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(p.x, p.y, R * 1.05, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  private drawCursors(scene: Scene): void {
    const { ctx } = this
    for (const c of scene.cursors) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(c.point.x, c.point.y, c.gripping ? 12 : 9, 0, Math.PI * 2)
      if (c.gripping) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
        ctx.fill()
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
        ctx.lineWidth = 2
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  private drawLandmarks(hands: TrackedHand[]): void {
    const { ctx } = this
    ctx.save()
    ctx.fillStyle = 'rgba(80, 220, 255, 0.9)'
    for (const h of hands) {
      for (const p of h.landmarks) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }
}
