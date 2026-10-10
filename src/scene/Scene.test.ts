import { describe, expect, it, vi } from 'vitest'
import { sceneConfig } from '../config'
import type { GripEvent, HandCursor, Site } from '../types'
import { Scene } from './Scene'

const SITES: Site[] = Array.from({ length: 12 }, (_, i) => ({
  id: `s${i}`,
  name: `Site ${i}`,
  url: `https://s${i}.com`,
  color: '#336699',
  iconPath: '',
}))
const row = (i: number) => (600 * (i + 1)) / 7

const cur = (handId: number, x: number, y: number, gripping = false): HandCursor => ({
  handId,
  point: { x, y },
  gripping,
})
const start = (handId: number, x: number, y: number): GripEvent => ({ type: 'gripStart', handId, point: { x, y } })
const end = (handId: number, x: number, y: number): GripEvent => ({ type: 'gripEnd', handId, point: { x, y } })

function setup() {
  const onFuse = vi.fn()
  const onOpenFused = vi.fn()
  const onFuseDismissed = vi.fn()
  // huge stiffness: held logos snap to the cursor each step, so tests don't wait on springs
  const scene = new Scene({
    leftSites: SITES.slice(0, 6),
    rightSites: SITES.slice(6),
    rows: 6,
    width: 1000,
    height: 600,
    onFuse,
    onOpenFused,
    onFuseDismissed,
    config: { ...sceneConfig, followStiffness: 1e6 },
  })
  let t = 1000
  scene.update(t, { cursors: [], events: [] })
  const step = (cursors: HandCursor[], events: GripEvent[] = []) => {
    t += 16
    scene.update(t, { cursors, events })
  }
  return { scene, onFuse, onOpenFused, onFuseDismissed, step }
}

describe('Scene basics', () => {
  it('fills the slots with the first site of each shelf', () => {
    const { scene } = setup()
    expect(scene.shelves.left).toEqual(['s0', 's1', 's2', 's3', 's4', 's5'])
    expect(scene.shelves.right).toEqual(['s6', 's7', 's8', 's9', 's10', 's11'])
    expect(scene.slots).toEqual(['s0', 's6'])
  })

  it('hovers a slot under an open-hand cursor', () => {
    const { scene, step } = setup()
    step([cur(1, 310, 300)])
    expect(scene.hover.get(1)).toEqual({ kind: 'slot', slot: 0 })
  })

  it('hovers a shelf logo', () => {
    const { scene, step } = setup()
    step([cur(1, 952, row(3))])
    expect(scene.hover.get(1)).toEqual({ kind: 'shelf', side: 'right', index: 3 })
  })

  it('grabbing empty space holds nothing', () => {
    const { scene, step } = setup()
    step([cur(1, 500, 100, true)], [start(1, 500, 100)])
    expect(scene.held.size).toBe(0)
  })

  it('a grabbed slot logo follows the hand and flies home when dropped on nothing', () => {
    const { scene, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 450, 150, true)])
    expect(scene.held.get(1)?.pos).toEqual({ x: 450, y: 150 })
    expect(scene.isSlotHidden(0)).toBe(true)
    step([cur(1, 450, 150)], [end(1, 450, 150)])
    expect(scene.held.size).toBe(0)
    expect(scene.slots).toEqual(['s0', 's6'])
    expect(scene.flights).toEqual([expect.objectContaining({ siteId: 's0', to: { x: 300, y: 300 }, hideSlot: 0 })])
  })

  it('pulling a reference logo onto the right slot replaces it and sends the old one home', () => {
    const { scene, step } = setup()
    step([cur(1, 952, row(2), true)], [start(1, 952, row(2))])
    expect(scene.held.get(1)?.siteId).toBe('s8')
    step([cur(1, 700, 300, true)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    expect(scene.slots).toEqual(['s0', 's8'])
    expect(scene.flights).toContainEqual(expect.objectContaining({ siteId: 's6', to: { x: 952, y: row(0) } }))
    expect(scene.flights).toContainEqual(expect.objectContaining({ siteId: 's8', hideSlot: 1 }))
  })

  it('a shelf logo dropped on nothing goes back to its shelf', () => {
    const { scene, step } = setup()
    step([cur(1, 48, row(2), true)], [start(1, 48, row(2))])
    step([cur(1, 500, 100)], [end(1, 500, 100)])
    expect(scene.slots).toEqual(['s0', 's6'])
    expect(scene.flights).toEqual([expect.objectContaining({ siteId: 's2', to: { x: 48, y: row(2) } })])
  })

  it('your logos can go in the right slot too, so two of your sites can fuse', () => {
    const { scene, step } = setup()
    step([cur(1, 48, row(2), true)], [start(1, 48, row(2))])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    expect(scene.slots).toEqual(['s0', 's2'])
    expect(scene.flights).toContainEqual(expect.objectContaining({ siteId: 's6', to: { x: 952, y: row(0) } }))
  })

  it('reference logos can go in the left slot too', () => {
    const { scene, step } = setup()
    step([cur(1, 952, row(2), true)], [start(1, 952, row(2))])
    step([cur(1, 300, 300)], [end(1, 300, 300)])
    expect(scene.slots).toEqual(['s8', 's6'])
  })

  it('refuses to put the same site in both slots', () => {
    const { scene, step } = setup()
    step([cur(1, 952, row(0), true)], [start(1, 952, row(0))])
    step([cur(1, 300, 300)], [end(1, 300, 300)])
    expect(scene.slots).toEqual(['s0', 's6'])
  })

  it('a left-shelf logo can replace the left slot', () => {
    const { scene, step } = setup()
    step([cur(1, 48, row(2), true)], [start(1, 48, row(2))])
    step([cur(1, 300, 300)], [end(1, 300, 300)])
    expect(scene.slots).toEqual(['s2', 's6'])
  })

  it('flights expire after returnMs', () => {
    const { scene, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 450, 150)], [end(1, 450, 150)])
    for (let i = 0; i < 20; i++) step([])
    expect(scene.flights).toEqual([])
    expect(scene.isSlotHidden(0)).toBe(false)
  })
})

describe('Scene fuse', () => {
  it('one hand: dropping a slot logo onto the other slot fuses', () => {
    const { scene, onFuse, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300, true)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    expect(onFuse).toHaveBeenCalledTimes(1)
    expect(scene.fuse?.status).toBe('fusing')
  })

  it('ignores slots and shelves during a fuse', () => {
    const { scene, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(2, 48, row(2), true)], [start(2, 48, row(2))])
    expect(scene.held.size).toBe(0)
  })

  it('the card glides to center and is dismissed by pulling it into the bottom zone, without releasing', () => {
    const { scene, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    step([])
    expect(scene.fuse?.at).toEqual({ x: 500, y: 300 })
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 500, 400, true)])
    expect(scene.fuse).not.toBeNull()
    step([cur(1, 500, 580, true)])
    expect(scene.fuse).toBeNull()
    expect(scene.held.size).toBe(0)
    step([cur(1, 500, 580)], [end(1, 500, 580)])
    expect(scene.slots).toEqual(['s0', 's6'])
  })

  it('left and right edges no longer dismiss', () => {
    const { scene, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 30, 300, true)])
    step([cur(1, 30, 300)], [end(1, 30, 300)])
    expect(scene.fuse).not.toBeNull()
  })

  it('pulling a finished card into the top zone opens it once and lets it go', () => {
    const { scene, onOpenFused, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    scene.setFuseResult(scene.fuse!.id, { siteA: 's0', siteB: 's6', label: 'Site 0 × Site 6' })
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 500, 40, true)])
    expect(onOpenFused).toHaveBeenCalledTimes(1)
    expect(onOpenFused.mock.calls[0].slice(0, 2).map((s: Site) => s.id)).toEqual(['s0', 's6'])
    expect(scene.held.size).toBe(0)
    step([cur(1, 500, 40, true)])
    expect(onOpenFused).toHaveBeenCalledTimes(1)
    expect(scene.fuse?.at).toEqual({ x: 500, y: 300 })
  })

  it('the top zone does nothing while still fusing', () => {
    const { scene, onOpenFused, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 500, 40, true)])
    expect(onOpenFused).not.toHaveBeenCalled()
    expect(scene.held.size).toBe(1)
  })

  it('a card dropped near the middle stays', () => {
    const { scene, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 450, 350)], [end(1, 450, 350)])
    expect(scene.fuse).not.toBeNull()
  })

  it('a failed fuse retries when the card is gripped and released', () => {
    const { scene, onFuse, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    step([])
    scene.setFuseError(scene.fuse!.id)
    expect(scene.fuse?.status).toBe('error')
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 500, 300)], [end(1, 500, 300)])
    expect(onFuse).toHaveBeenCalledTimes(2)
    expect(scene.fuse?.status).toBe('fusing')
  })

  it('ignores a result for a pair that is no longer fusing', () => {
    const { scene } = setup()
    scene.setFuseResult(1, { siteA: 's0', siteB: 's6', label: 'x' })
    expect(scene.fuse).toBeNull()
  })

  it('passes the fuse id to onFuse', () => {
    const { scene, onFuse, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    expect(onFuse.mock.calls[0][2]).toBe(scene.fuse!.id)
  })

  it('ignores a stale result from a dismissed fuse of the same pair', () => {
    const { scene, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    const oldId = scene.fuse!.id
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 500, 580, true)])
    step([cur(1, 500, 580)], [end(1, 500, 580)])
    expect(scene.fuse).toBeNull()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    expect(scene.fuse!.id).not.toBe(oldId)
    scene.setFuseResult(oldId, { siteA: 's0', siteB: 's6', label: 'old' })
    expect(scene.fuse?.status).toBe('fusing')
    scene.setFuseError(oldId)
    expect(scene.fuse?.status).toBe('fusing')
  })

  it('a retry gets a new id and ignores errors for the old one', () => {
    const { scene, onFuse, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    step([])
    const oldId = scene.fuse!.id
    scene.setFuseError(oldId)
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 500, 300)], [end(1, 500, 300)])
    expect(scene.fuse!.id).not.toBe(oldId)
    expect(onFuse.mock.calls[1][2]).toBe(scene.fuse!.id)
    scene.setFuseError(oldId)
    expect(scene.fuse?.status).toBe('fusing')
  })
})

describe('Scene collision fuse', () => {
  const grabBoth = (step: ReturnType<typeof setup>['step']) =>
    step([cur(1, 300, 300, true), cur(2, 700, 300, true)], [start(1, 300, 300), start(2, 700, 300)])

  it('touching logos collide instead of overlapping', () => {
    const { scene, step } = setup()
    grabBoth(step)
    step([cur(1, 480, 300, true), cur(2, 520, 300, true)])
    const [a, b] = [...scene.held.values()]
    const contact = 2 * scene.layout.slotRadius * sceneConfig.heldScale
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y)).toBeGreaterThanOrEqual(contact - 0.5)
    expect(scene.collision?.push).toBeGreaterThan(0)
    expect(scene.fuse).toBeNull()
  })

  it('pushing hard for about a second fuses', () => {
    const { scene, onFuse, step } = setup()
    grabBoth(step)
    for (let i = 0; i < 70 && !scene.fuse; i++) step([cur(1, 470, 300, true), cur(2, 530, 300, true)])
    expect(onFuse).toHaveBeenCalledTimes(1)
    expect(onFuse.mock.calls[0].slice(0, 2).map((s: Site) => s.id)).toEqual(['s0', 's6'])
    expect(scene.held.size).toBe(0)
    expect(scene.collision).toBeNull()
  })

  it('a light touch does not fuse, and easing off drains the charge', () => {
    const { scene, onFuse, step } = setup()
    grabBoth(step)
    const contact = 2 * scene.layout.slotRadius * sceneConfig.heldScale
    // cursors exactly at contact distance: push 0
    for (let i = 0; i < 120; i++) step([cur(1, 500 - contact / 2, 300, true), cur(2, 500 + contact / 2, 300, true)])
    expect(onFuse).not.toHaveBeenCalled()
    for (let i = 0; i < 20; i++) step([cur(1, 470, 300, true), cur(2, 530, 300, true)])
    const charged = scene.collision?.charge ?? 0
    expect(charged).toBeGreaterThan(0)
    for (let i = 0; i < 60; i++) step([cur(1, 300, 300, true), cur(2, 700, 300, true)])
    expect(scene.collision?.charge ?? 0).toBe(0)
    expect(onFuse).not.toHaveBeenCalled()
  })
})

describe('Scene card zones follow the hand', () => {
  function finished() {
    const ctx = setup()
    const { scene, step } = ctx
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    step([])
    return ctx
  }

  it('dismisses when the cursor, not the card, enters the bottom zone', () => {
    const { scene, step } = finished()
    step([cur(1, 500, 400, true)], [start(1, 500, 400)])
    expect(scene.held.get(1)?.from).toEqual({ kind: 'card' })
    step([cur(1, 500, 520, true)])
    expect(scene.fuse).toBeNull()
  })

  it('opens when the cursor, not the card, enters the top zone', () => {
    const { scene, onOpenFused, step } = finished()
    scene.setFuseResult(scene.fuse!.id, { siteA: 's0', siteB: 's6', label: 'x' })
    step([cur(1, 500, 200, true)], [start(1, 500, 200)])
    step([cur(1, 500, 80, true)])
    expect(onOpenFused).toHaveBeenCalledTimes(1)
  })

  it('ignores the top zone for 1s after opening', () => {
    const { scene, onOpenFused, step } = finished()
    scene.setFuseResult(scene.fuse!.id, { siteA: 's0', siteB: 's6', label: 'x' })
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 500, 40, true)])
    expect(onOpenFused).toHaveBeenCalledTimes(1)
    step([cur(1, 500, 300)], [end(1, 500, 300)])
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 500, 40, true)])
    expect(onOpenFused).toHaveBeenCalledTimes(1)
    step([cur(1, 500, 300)], [end(1, 500, 300)])
    for (let i = 0; i < 70; i++) step([])
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 500, 40, true)])
    expect(onOpenFused).toHaveBeenCalledTimes(2)
  })
})

describe('Scene grab offset and flights', () => {
  it('keeps the grab offset instead of jumping to the cursor', () => {
    const { scene, step } = setup()
    step([cur(1, 340, 320, true)], [start(1, 340, 320)])
    expect(scene.held.get(1)?.pos).toEqual({ x: 300, y: 300 })
    step([cur(1, 440, 420, true)])
    expect(scene.held.get(1)?.pos).toEqual({ x: 400, y: 400 })
  })

  it('on a 4:3 window, logos gripped at the inner edges collide and fuse only when pushed', () => {
    const onFuse = vi.fn()
    const scene = new Scene({
      leftSites: SITES.slice(0, 6),
      rightSites: SITES.slice(6),
      rows: 6,
      width: 1024,
      height: 768,
      onFuse,
      onOpenFused: vi.fn(),
      config: { ...sceneConfig, followStiffness: 1e6 },
    })
    let t = 1000
    const step = (cursors: HandCursor[], events: GripEvent[] = []) => {
      t += 16
      scene.update(t, { cursors, events })
    }
    scene.update(t, { cursors: [], events: [] })
    const { slots, slotRadius } = scene.layout
    const y = slots[0].y
    const a = { x: slots[0].x + 1.25 * slotRadius, y }
    const b = { x: slots[1].x - 1.25 * slotRadius, y }
    step([cur(1, a.x, a.y, true), cur(2, b.x, b.y, true)], [start(1, a.x, a.y), start(2, b.x, b.y)])
    expect(scene.held.size).toBe(2)
    for (let i = 0; i < 5; i++) step([cur(1, a.x, a.y, true), cur(2, b.x, b.y, true)])
    expect(onFuse).not.toHaveBeenCalled()
    const mid = scene.layout.center.x
    // grabbed at the inner edges, the logos touch before the cursors meet; keep pushing
    for (let i = 0; i < 70 && !scene.fuse; i++) step([cur(1, mid + slotRadius, y, true), cur(2, mid - slotRadius, y, true)])
    expect(onFuse).toHaveBeenCalledTimes(1)
  })

  it('does not offer a slot whose logo is still flying in', () => {
    const { scene, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 450, 150)], [end(1, 450, 150)])
    step([cur(2, 300, 300, true)], [start(2, 300, 300)])
    expect(scene.held.size).toBe(0)
    for (let i = 0; i < 20; i++) step([])
    step([cur(2, 300, 300, true)], [start(2, 300, 300)])
    expect(scene.held.size).toBe(1)
  })
})

describe('Scene: your sites', () => {
  const site = (id: string): Site => ({ id, name: id, url: `https://${id}`, color: '#123456', logoUrl: `/x/${id}` })

  it('adds a site to the front of the left shelf and into the left slot', () => {
    const { scene } = setup()
    scene.addLeftSite(site('mine.com'))
    expect(scene.shelves.left).toEqual(['mine.com', 's0', 's1', 's2', 's3', 's4'])
    expect(scene.slots[0]).toBe('mine.com')
    expect(scene.site('mine.com').name).toBe('mine.com')
    expect(scene.layout.shelf.left).toHaveLength(6)
  })

  it('re-adding an existing site moves it to the front', () => {
    const { scene } = setup()
    scene.addLeftSite(SITES[3])
    expect(scene.shelves.left).toEqual(['s3', 's0', 's1', 's2', 's4', 's5'])
    expect(scene.slots[0]).toBe('s3')
  })

  it('does not swap the left slot while it is held', () => {
    const { scene, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    scene.addLeftSite(site('mine.com'))
    expect(scene.slots[0]).toBe('s0')
    expect(scene.shelves.left).toContain('s0')
  })

  it('starts with one site on the left and lays 12 reference sites in two columns', () => {
    const scene = new Scene({
      leftSites: [site('mine.com')],
      rightSites: SITES,
      rows: 6,
      width: 1000,
      height: 600,
      onFuse: vi.fn(),
      onOpenFused: vi.fn(),
    })
    expect(scene.slots).toEqual(['mine.com', 's0'])
    expect(scene.layout.shelf.left).toHaveLength(1)
    expect(scene.layout.shelf.right[6].x).toBe(880)
  })

  it('keeps a held shelf logo and sends it to its new position', () => {
    const { scene, step } = setup()
    step([cur(1, 48, row(5), true)], [start(1, 48, row(5))])
    expect(scene.held.get(1)?.siteId).toBe('s5')
    scene.addLeftSite(site('mine.com'))
    expect(scene.shelves.left).toContain('s5')
    const idx = scene.shelves.left.indexOf('s5')
    step([cur(1, 500, 100)], [end(1, 500, 100)])
    expect(scene.flights).toEqual([expect.objectContaining({ siteId: 's5', to: scene.layout.shelf.left[idx] })])
  })

  it('does not throw when the replaced slot site is no longer on a shelf', () => {
    const { scene, step } = setup()
    for (let i = 0; i < 7; i++) scene.addLeftSite(site(`m${i}.com`))
    step([cur(1, 48, row(1), true)], [start(1, 48, row(1))])
    expect(() => step([cur(1, 300, 300)], [end(1, 300, 300)])).not.toThrow()
  })

  it('reports the dismissed fuse id so the request can be cancelled', () => {
    const { scene, onFuseDismissed, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    const id = scene.fuse!.id
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 500, 580, true)])
    expect(onFuseDismissed).toHaveBeenCalledWith(id)
  })

  it('records when the result arrived and passes it to onOpenFused', () => {
    const { scene, onOpenFused, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    const result = { siteA: 's0', siteB: 's6', label: 'x', logoUrl: '/api/fuse-logo/img?id=s0__s6' }
    scene.setFuseResult(scene.fuse!.id, result)
    expect(scene.fuse!.doneAt).toBe(scene.now)
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 500, 40, true)])
    expect(onOpenFused.mock.calls[0][2]).toEqual(result)
  })
})
