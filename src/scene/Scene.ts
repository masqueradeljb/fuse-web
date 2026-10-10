import { sceneConfig as defaultConfig, type SceneConfig } from '../config'
import type { FuseResult } from '../fuse/FuseClient'
import type { PageStatus } from '../fuse/siteJobs'
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

/** Two held slot logos pressed into each other. */
export interface Collision {
  /** contact point between the two logos */
  point: Point
  /** unit vector from logo A to logo B */
  axis: Point
  /** 0–1: how far the hands push past contact */
  push: number
  /** 0–1: fuses at 1 */
  charge: number
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
  /** fused landing page job status (undefined = no job) */
  pageStatus?: PageStatus
  /** scene time when the result arrived */
  doneAt?: number
  /** current card position */
  at: Point
}

export interface SceneOptions {
  /** the user's sites, newest first; the first fills the left slot */
  leftSites: Site[]
  /** reference sites; the first fills the right slot */
  rightSites: Site[]
  /** logos per shelf column; also the max number of the user's sites kept */
  rows: number
  width: number
  height: number
  onFuse: (a: Site, b: Site, fuseId: number) => void
  /** a finished card was pulled into the top zone */
  onOpenFused: (a: Site, b: Site, result: FuseResult | null) => void
  /** the card was dismissed; cancel its in-flight request */
  onFuseDismissed?: (fuseId: number) => void
  config?: SceneConfig
}

/** a slot's fallback shelf when its site has left every shelf */
const SIDE_OF: Record<0 | 1, Side> = { 0: 'left', 1: 'right' }

const SLOTS = [0, 1] as const
/** after opening the fused page, the top zone is ignored this long */
const OPEN_COOLDOWN_MS = 1000
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
  /** set while two held slot logos touch, or while their charge drains */
  collision: Collision | null = null
  now = 0

  private readonly sitesById = new Map<string, Site>()
  private readonly config: SceneConfig
  private readonly onFuse: (a: Site, b: Site, fuseId: number) => void
  private readonly onOpenFused: (a: Site, b: Site, result: FuseResult | null) => void
  private readonly onFuseDismissed?: (fuseId: number) => void
  private readonly rows: number
  private width: number
  private height: number
  private nextFuseId = 1
  private openCooldownUntil = 0

  constructor(opts: SceneOptions) {
    if (!opts.leftSites.length || !opts.rightSites.length) throw new Error('need at least one site on each side')
    this.config = opts.config ?? defaultConfig
    this.rows = opts.rows
    this.onFuse = opts.onFuse
    this.onOpenFused = opts.onOpenFused
    this.onFuseDismissed = opts.onFuseDismissed
    for (const s of [...opts.leftSites, ...opts.rightSites]) this.sitesById.set(s.id, s)
    this.shelves = { left: opts.leftSites.slice(0, opts.rows).map((s) => s.id), right: opts.rightSites.map((s) => s.id) }
    this.slots = [this.shelves.left[0], this.shelves.right[0]]
    this.width = opts.width
    this.height = opts.height
    this.layout = this.relayout()
  }

  site(id: string): Site {
    const s = this.sitesById.get(id)
    if (!s) throw new Error(`unknown site ${id}`)
    return s
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
    this.layout = this.relayout()
  }

  /** Adds one of the user's sites (or moves it) to the front of the left shelf and into the left slot. */
  addLeftSite(site: Site): void {
    this.sitesById.set(site.id, site)
    const left = [site.id, ...this.shelves.left.filter((id) => id !== site.id)]
    if (!this.isSlotHeld(0)) this.slots[0] = site.id
    // keep at most `rows`, never dropping a site that's in a slot or held
    const keep = new Set<string>(this.slots)
    for (const h of this.held.values()) if (h.siteId) keep.add(h.siteId)
    for (let i = left.length - 1; left.length > this.rows && i >= 0; i--) {
      if (!keep.has(left[i])) left.splice(i, 1)
    }
    this.shelves.left.splice(0, this.shelves.left.length, ...left)
    // held left-shelf logos keep their way home by site id
    for (const h of this.held.values()) {
      if (h.from.kind === 'shelf' && h.from.side === 'left' && h.siteId) {
        h.from = { kind: 'shelf', side: 'left', index: Math.max(0, this.shelves.left.indexOf(h.siteId)) }
      }
    }
    this.layout = this.relayout()
  }

  /** y thresholds: above `top` opens the fused page, below `bottom` dismisses the card */
  cardZones(): { top: number; bottom: number } {
    const z = this.config.cardZone * this.layout.height
    return { top: z, bottom: this.layout.height - z }
  }

  isCardHeld(): boolean {
    return this.cardHold() !== undefined
  }

  private relayout(): Layout {
    return computeLayout(this.width, this.height, { left: this.shelves.left.length, right: this.shelves.right.length }, this.rows)
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

    const card = this.fuse ? this.cardHold() : undefined
    if (this.fuse) this.fuse.at = card ? { ...card.pos } : lerp(this.fuse.at, this.layout.center, k)
    if (card) this.checkCardZones(card)

    this.flights = this.flights.filter((f) => now - f.startedAt < this.config.returnMs)
    this.updateHover()
    this.collide(dt)
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
      f.doneAt = this.now
    }
  }

  setPageStatus(fuseId: number, status: PageStatus): void {
    const f = this.fuse
    if (f && f.id === fuseId) f.pageStatus = status
  }

  setFuseError(fuseId: number): void {
    const f = this.fuse
    if (f && f.id === fuseId) f.status = 'error'
  }

  private checkCardZones(card: Held): void {
    const f = this.fuse
    if (!f) return
    const { top, bottom } = this.cardZones()
    const handY = card.target.y - card.grabOffset.y
    if (handY > bottom) {
      this.held.delete(card.handId)
      this.fuse = null
      this.onFuseDismissed?.(f.id)
    } else if (handY < top && f.status === 'done' && this.now >= this.openCooldownUntil) {
      // let go so it glides back; the hand must release and grip again to re-open
      this.held.delete(card.handId)
      this.openCooldownUntil = this.now + OPEN_COOLDOWN_MS
      this.onOpenFused(this.site(f.siteA), this.site(f.siteB), f.result)
    }
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

  /** where a site rests on a shelf; if it was trimmed off, the first spot on `preferred` side */
  private shelfPosOf(siteId: string, preferred: Side): Point {
    for (const side of SIDES) {
      const index = this.shelves[side].indexOf(siteId)
      if (index !== -1) return this.layout.shelf[side][index]
    }
    return this.layout.shelf[preferred][0] ?? this.layout.center
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
      this.dropCard()
      return
    }

    const L = this.layout
    const siteId = h.siteId as string
    const r = this.heldRadius(h)
    const target = this.slotAt(e.point)

    if (h.from.kind === 'shelf') {
      // any shelf logo may go in either slot, as long as the two slots stay different sites
      const slot = target
      if (slot !== null && !this.isSlotHeld(slot) && this.slots[slot === 0 ? 1 : 0] !== siteId) {
        const replaced = this.slots[slot]
        if (replaced !== siteId) this.fly(replaced, L.slots[slot], this.shelfPosOf(replaced, SIDE_OF[slot]), L.slotRadius, L.shelfRadius)
        this.slots[slot] = siteId
        this.fly(siteId, h.pos, L.slots[slot], r, L.slotRadius, slot)
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

  /**
   * Two held slot logos can't overlap: they stop at contact. How far the hands push past
   * contact charges the fuse; easing off drains it.
   */
  private collide(dt: number): void {
    const holds = this.fuse ? [] : [...this.held.values()].filter((h) => h.from.kind === 'slot')
    if (holds.length !== 2) {
      this.collision = null
      return
    }
    const [a, b] = holds
    const c = this.config
    const contact = 2 * this.layout.slotRadius * c.heldScale
    const prev = this.collision
    // axis A→B: from the logos while apart; while pressed, keep the last one, so hands that
    // cross over push harder instead of passing the logos through each other
    const pd = dist(a.pos, b.pos)
    const axis =
      prev && pd < contact + 0.5
        ? prev.axis
        : pd > 1e-6
          ? { x: (b.pos.x - a.pos.x) / pd, y: (b.pos.y - a.pos.y) / pd }
          : { x: 1, y: 0 }
    if (pd < contact) {
      const mid = lerp(a.pos, b.pos, 0.5)
      a.pos = { x: mid.x - (axis.x * contact) / 2, y: mid.y - (axis.y * contact) / 2 }
      b.pos = { x: mid.x + (axis.x * contact) / 2, y: mid.y + (axis.y * contact) / 2 }
    }
    // how far the hands want the logos to go, measured along the axis (negative = crossed)
    const want = (b.target.x - a.target.x) * axis.x + (b.target.y - a.target.y) * axis.y
    const push = Math.min(Math.max((contact - want) / contact, 0), 1)
    const prevCharge = prev?.charge ?? 0
    if (push <= 0 && prevCharge <= 0) {
      this.collision = null
      return
    }
    const charge =
      push > c.chargeMinPush
        ? prevCharge + dt * (c.chargeBase + c.chargeGain * push)
        : Math.max(0, prevCharge - dt * c.chargeDecay)
    if (charge >= 1) {
      this.collision = null
      this.startFuse(lerp(a.pos, b.pos, 0.5))
      return
    }
    this.collision = { point: lerp(a.pos, b.pos, 0.5), axis, push, charge }
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

  private dropCard(): void {
    const f = this.fuse
    if (f?.status !== 'error') return
    f.status = 'fusing'
    f.startedAt = this.now
    f.id = this.nextFuseId++
    this.onFuse(this.site(f.siteA), this.site(f.siteB), f.id)
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
