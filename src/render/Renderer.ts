import { sameRef, type ItemRef, type Scene } from '../scene/Scene'
import { coverRect } from '../tracking/coords'
import type { Point, Site, TrackedHand } from '../types'
import { glyphImage } from './logoImages'

/** Draws a Scene onto a canvas. Reads the scene; never changes it. */
export class Renderer {
  showDebug = false
  private ctx: CanvasRenderingContext2D
  private glyphs = new Map<string, HTMLImageElement>()

  constructor(
    private canvas: HTMLCanvasElement,
    sites: Site[],
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas unavailable')
    this.ctx = ctx
    for (const s of sites) this.glyphs.set(s.id, glyphImage(s))
  }

  resize(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1
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
    this.drawFuse(scene)
    this.drawCursors(scene)
    if (this.showDebug) this.drawLandmarks(hands)
  }

  private hovered(scene: Scene, ref: ItemRef): boolean {
    for (const h of scene.hover.values()) if (sameRef(h, ref)) return true
    return false
  }

  private drawLogo(site: Site, p: Point, r: number, glow = false, alpha = 1): void {
    const { ctx } = this
    ctx.save()
    ctx.globalAlpha = alpha
    if (glow) {
      ctx.shadowColor = 'rgba(255, 255, 255, 0.9)'
      ctx.shadowBlur = r * 0.8
    }
    ctx.fillStyle = site.color
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    const img = this.glyphs.get(site.id)
    if (img?.complete) {
      const s = r * 1.1
      ctx.drawImage(img, p.x - s / 2, p.y - s / 2, s, s)
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
    for (const h of scene.held.values()) {
      if (h.siteId) this.drawLogo(scene.site(h.siteId), h.pos, scene.heldRadius(h), true)
    }
  }

  private drawFuse(scene: Scene): void {
    const f = scene.fuse
    if (!f) return
    const { ctx } = this
    const a = scene.site(f.siteA)
    const b = scene.site(f.siteB)
    const R = scene.layout.cardRadius
    const p = f.at
    const age = scene.now - f.startedAt

    if (age < 600) {
      const k = age / 600
      ctx.save()
      ctx.strokeStyle = `rgba(255, 255, 255, ${1 - k})`
      ctx.lineWidth = 8 * (1 - k) + 1
      ctx.beginPath()
      ctx.arc(p.x, p.y, R * (0.5 + 1.5 * k), 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    ctx.save()
    if (this.hovered(scene, { kind: 'card' })) {
      ctx.shadowColor = 'rgba(255, 255, 255, 0.9)'
      ctx.shadowBlur = R * 0.5
    }
    ctx.beginPath()
    ctx.arc(p.x, p.y, R, 0, Math.PI * 2)
    ctx.fillStyle = a.color
    ctx.fill()
    ctx.clip()
    ctx.fillStyle = b.color
    ctx.fillRect(p.x, p.y - R, R, R * 2)
    ctx.restore()

    if (f.status === 'fusing') {
      const angle = age / 300
      const off = R * 0.3
      this.drawLogo(a, { x: p.x + Math.cos(angle) * off, y: p.y + Math.sin(angle) * off }, R * 0.4)
      this.drawLogo(b, { x: p.x - Math.cos(angle) * off, y: p.y - Math.sin(angle) * off }, R * 0.4)
    } else {
      this.drawLogo(a, { x: p.x - R * 0.25, y: p.y }, R * 0.45)
      this.drawLogo(b, { x: p.x + R * 0.25, y: p.y }, R * 0.45)
    }

    const status =
      f.status === 'fusing' ? 'fusing…' : f.status === 'error' ? 'failed — grip to retry' : 'pull to an edge to dismiss'
    ctx.save()
    ctx.textAlign = 'center'
    ctx.fillStyle = '#ffffff'
    ctx.font = '600 22px system-ui, sans-serif'
    ctx.fillText(f.result?.label ?? `${a.name} × ${b.name}`, p.x, p.y + R + 36)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
    ctx.font = '14px system-ui, sans-serif'
    ctx.fillText(status, p.x, p.y + R + 60)
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
