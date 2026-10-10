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
  // huge stiffness: held logos snap to the cursor each step, so tests don't wait on springs
  const scene = new Scene({
    sites: SITES,
    perShelf: 6,
    width: 1000,
    height: 600,
    onFuse,
    config: { ...sceneConfig, followStiffness: 1e6 },
  })
  let t = 1000
  scene.update(t, { cursors: [], events: [] })
  const step = (cursors: HandCursor[], events: GripEvent[] = []) => {
    t += 16
    scene.update(t, { cursors, events })
  }
  return { scene, onFuse, step }
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

  it('pulling a shelf logo onto a slot replaces it and sends the old one home', () => {
    const { scene, step } = setup()
    step([cur(1, 48, row(2), true)], [start(1, 48, row(2))])
    expect(scene.held.get(1)?.siteId).toBe('s2')
    step([cur(1, 700, 300, true)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    expect(scene.slots).toEqual(['s0', 's2'])
    expect(scene.flights).toContainEqual(expect.objectContaining({ siteId: 's6', to: { x: 952, y: row(0) } }))
    expect(scene.flights).toContainEqual(expect.objectContaining({ siteId: 's2', hideSlot: 1 }))
  })

  it('a shelf logo dropped on nothing goes back to its shelf', () => {
    const { scene, step } = setup()
    step([cur(1, 48, row(2), true)], [start(1, 48, row(2))])
    step([cur(1, 500, 100)], [end(1, 500, 100)])
    expect(scene.slots).toEqual(['s0', 's6'])
    expect(scene.flights).toEqual([expect.objectContaining({ siteId: 's2', to: { x: 48, y: row(2) } })])
  })

  it('refuses to put the same site in both slots', () => {
    const { scene, step } = setup()
    step([cur(1, 952, row(0), true)], [start(1, 952, row(0))]) // s6, already in slot 1
    step([cur(1, 300, 300)], [end(1, 300, 300)])
    expect(scene.slots).toEqual(['s0', 's6'])
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
