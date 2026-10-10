import { sceneConfig as defaultConfig, type SceneConfig } from '../config'
import type { FuseResult } from '../fuse/FuseClient'
import type { GripEvent, HandCursor, InputFrame, Point, Site } from '../types'
import { computeLayout, type Layout, type Side } from './layout'

export type ItemRef =
  | { kind: 'shelf'; side: Side; index: number }
  | { kind: 'slot'; slot: 0 | 1 }
  | { kind: 'card' }

export function sameRef(a: ItemRef, b: ItemRef): boolean {
  if (a.kind === 'shelf' && b.kind === 'shelf') return a.side === b.side && a.index === b.index
  if (a.kind === 'slot' && b.kind === 'slot') return a.slot === b.slot
  return a.kind === b.kind
}

export interface Held {
  handId: number
  /** null when the hand holds the fuse result card */
  siteId: string | null
  from: ItemRef
  pos: Point
  target: Point
  /** item position minus cursor position at grab time, so the logo does not jump */
  grabOffset: Point
}

export interface Flight {
  siteId: string
  from: Point
  to: Point
  fromRadius: number
  toRadius: number
  startedAt: number
  /** keep this center slot empty until the flight lands */
  hideSlot?: 0 | 1
}

export type FuseStatus = 'fusing' | 'done' | 'error'

export interface FuseState {
  /** unique per fuse attempt; results and errors are matched on it */
  id: number
  siteA: string
  siteB: string
  status: FuseStatus
  startedAt: number
  result: FuseResult | null
  /** current card position */
  at: Point
}

export interface SceneOptions {
  sites: Site[]
  perShelf: number
  width: number
  height: number
  onFuse: (a: Site, b: Site, fuseId: number) => void
  config?: SceneConfig
}

const SLOTS = [0, 1] as const
const SIDES = ['left', 'right'] as const
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const lerp = (a: Point, b: Point, k: number): Point => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k })

/** All interaction state and rules. No DOM, no camera: driven by InputFrames. */
export class Scene {
  layout: Layout
  readonly shelves: Record<Side, string[]>
  readonly slots: [string, string]
  readonly held = new Map<number, Held>()
  readonly hover = new Map<number, ItemRef>()
  cursors: HandCursor[] = []
  flights: Flight[] = []
  fuse: FuseState | null = null
  now = 0

  private readonly sitesById: Map<string, Site>
  private readonly config: SceneConfig
  private readonly onFuse: (a: Site, b: Site, fuseId: number) => void
  private nextFuseId = 1
  private readonly perShelf: number

  constructor(opts: SceneOptions) {
    if (opts.sites.length < opts.perShelf * 2) throw new Error(`need at least ${opts.perShelf * 2} sites`)
    this.config = opts.config ?? defaultConfig
    this.perShelf = opts.perShelf
    this.onFuse = opts.onFuse
    this.sitesById = new Map(opts.sites.map((s) => [s.id, s]))
    const ids = opts.sites.map((s) => s.id)
    this.shelves = { left: ids.slice(0, opts.perShelf), right: ids.slice(opts.perShelf, opts.perShelf * 2) }
    this.slots = [this.shelves.left[0], this.shelves.right[0]]
    this.layout = computeLayout(opts.width, opts.height, opts.perShelf)
  }

  site(id: string): Site {
    const s = this.sitesById.get(id)
    if (!s) throw new Error(`unknown site ${id}`)
    return s
  }

  resize(width: number, height: number): void {
    this.layout = computeLayout(width, height, this.perShelf)
  }

  update(now: number, input: InputFrame): void {
    const dt = this.now === 0 ? 0 : Math.min((now - this.now) / 1000, 0.1)
    this.now = now
    this.cursors = input.cursors

    for (const e of input.events) {
      if (e.type === 'gripStart') this.gripStart(e)
      else this.gripEnd(e)
    }

    const k = 1 - Math.exp(-dt * this.config.followStiffness)
    for (const h of this.held.values()) {
      const c = input.cursors.find((c) => c.handId === h.handId)
      if (c) h.target = { x: c.point.x + h.grabOffset.x, y: c.point.y + h.grabOffset.y }
      h.pos = lerp(h.pos, h.target, k)
    }

    if (this.fuse) {
      const card = this.cardHold()
      this.fuse.at = card ? { ...card.pos } : lerp(this.fuse.at, this.layout.center, k)
    }

    this.flights = this.flights.filter((f) => now - f.startedAt < this.config.returnMs)
    this.updateHover()
    this.checkTwoHandFuse()
  }

  /** 0 → 1 with ease-out, for drawing a flight */
  flightProgress(f: Flight): number {
    const t = Math.min(Math.max((this.now - f.startedAt) / this.config.returnMs, 0), 1)
    return 1 - (1 - t) ** 3
  }

  heldRadius(h: Held): number {
    const L = this.layout
    if (h.from.kind === 'card') return L.cardRadius
    const base = h.from.kind === 'shelf' ? L.shelfRadius * 1.6 : L.slotRadius
    return base * this.config.heldScale
  }

  isSlotHeld(slot: 0 | 1): boolean {
    for (const h of this.held.values()) if (h.from.kind === 'slot' && h.from.slot === slot) return true
    return false
  }

  /** a slot draws empty while its logo is held or flying back into it */
  isSlotHidden(slot: 0 | 1): boolean {
    return this.isSlotHeld(slot) || this.flights.some((f) => f.hideSlot === slot)
  }

  hitTest(p: Point): ItemRef | null {
    const L = this.layout
    const near = (c: Point, r: number) => dist(p, c) <= r * this.config.hoverFactor
    if (this.fuse) return !this.cardHold() && near(this.fuse.at, L.cardRadius) ? { kind: 'card' } : null
    for (const slot of SLOTS) {
      if (!this.isSlotHidden(slot) && near(L.slots[slot], L.slotRadius)) return { kind: 'slot', slot }
    }
    for (const side of SIDES) {
      const index = L.shelf[side].findIndex((c) => near(c, L.shelfRadius))
      if (index !== -1) return { kind: 'shelf', side, index }
    }
    return null
  }

  setFuseResult(fuseId: number, result: FuseResult): void {
    const f = this.fuse
    if (f && f.id === fuseId) {
      f.status = 'done'
      f.result = result
    }
  }

  setFuseError(fuseId: number): void {
    const f = this.fuse
    if (f && f.id === fuseId) f.status = 'error'
  }

  private cardHold(): Held | undefined {
    for (const h of this.held.values()) if (h.from.kind === 'card') return h
    return undefined
  }

  private itemPos(ref: ItemRef): Point {
    if (ref.kind === 'shelf') return this.layout.shelf[ref.side][ref.index]
    if (ref.kind === 'slot') return this.layout.slots[ref.slot]
    return this.fuse ? this.fuse.at : this.layout.center
  }

  private shelfPosOf(siteId: string): Point {
    for (const side of SIDES) {
      const index = this.shelves[side].indexOf(siteId)
      if (index !== -1) return this.layout.shelf[side][index]
    }
    throw new Error(`site ${siteId} is not on a shelf`)
  }

  private slotAt(p: Point): 0 | 1 | null {
    for (const slot of SLOTS) {
      if (dist(p, this.layout.slots[slot]) <= this.layout.slotRadius * this.config.hoverFactor) return slot
    }
    return null
  }

  private fly(siteId: string, from: Point, to: Point, fromRadius: number, toRadius: number, hideSlot?: 0 | 1): void {
    this.flights.push({ siteId, from: { ...from }, to: { ...to }, fromRadius, toRadius, startedAt: this.now, hideSlot })
  }

  private gripStart(e: GripEvent): void {
    if (this.held.has(e.handId)) return
    const hit = this.hitTest(e.point)
    if (!hit) return
    const siteId =
      hit.kind === 'shelf' ? this.shelves[hit.side][hit.index] : hit.kind === 'slot' ? this.slots[hit.slot] : null
    const pos = { ...this.itemPos(hit) }
    const grabOffset = { x: pos.x - e.point.x, y: pos.y - e.point.y }
    this.held.set(e.handId, { handId: e.handId, siteId, from: hit, pos, target: { ...pos }, grabOffset })
  }

  private gripEnd(e: GripEvent): void {
    const h = this.held.get(e.handId)
    if (!h) return
    this.held.delete(e.handId)
    if (h.from.kind === 'card') {
      this.dropCard(e.point)
      return
    }

    const L = this.layout
    const siteId = h.siteId as string
    const r = this.heldRadius(h)
    const target = this.slotAt(e.point)

    if (h.from.kind === 'shelf') {
      const otherSite = target === null ? null : this.slots[target === 0 ? 1 : 0]
      if (target !== null && !this.isSlotHeld(target) && otherSite !== siteId) {
        const replaced = this.slots[target]
        if (replaced !== siteId) this.fly(replaced, L.slots[target], this.shelfPosOf(replaced), L.slotRadius, L.shelfRadius)
        this.slots[target] = siteId
        this.fly(siteId, h.pos, L.slots[target], r, L.slotRadius, target)
      } else {
        this.fly(siteId, h.pos, this.itemPos(h.from), r, L.shelfRadius)
      }
      return
    }

    const other = h.from.slot === 0 ? 1 : 0
    if (target === other && !this.isSlotHeld(other)) {
      this.startFuse(L.slots[other])
      return
    }
    this.fly(siteId, h.pos, L.slots[h.from.slot], r, L.slotRadius, h.from.slot)
  }

  private checkTwoHandFuse(): void {
    if (this.fuse) return
    const holds = [...this.held.values()].filter((h) => h.from.kind === 'slot')
    if (holds.length !== 2) return
    const [a, b] = holds
    if (dist(a.pos, b.pos) < this.config.fuseDistanceFactor * 2 * this.layout.slotRadius) {
      this.startFuse(lerp(a.pos, b.pos, 0.5))
    }
  }

  private startFuse(at: Point): void {
    const L = this.layout
    for (const h of this.held.values()) {
      if (h.from.kind === 'shelf' && h.siteId) this.fly(h.siteId, h.pos, this.itemPos(h.from), this.heldRadius(h), L.shelfRadius)
    }
    // hands that were holding slot logos now hold nothing; their gripEnd is ignored
    this.held.clear()
    this.flights = this.flights.filter((f) => f.hideSlot === undefined)
    const [a, b] = this.slots
    this.fuse = { id: this.nextFuseId++, siteA: a, siteB: b, status: 'fusing', startedAt: this.now, result: null, at: { ...at } }
    this.onFuse(this.site(a), this.site(b), this.fuse.id)
  }

  private dropCard(p: Point): void {
    const f = this.fuse
    if (!f) return
    const edge = this.config.dismissEdge * this.layout.width
    if (p.x < edge || p.x > this.layout.width - edge) {
      this.fuse = null
      return
    }
    if (f.status === 'error') {
      f.status = 'fusing'
      f.startedAt = this.now
      f.id = this.nextFuseId++
      this.onFuse(this.site(f.siteA), this.site(f.siteB), f.id)
    }
  }

  private updateHover(): void {
    this.hover.clear()
    for (const c of this.cursors) {
      if (this.held.has(c.handId)) continue
      const hit = this.hitTest(c.point)
      if (hit) this.hover.set(c.handId, hit)
    }
  }
}
