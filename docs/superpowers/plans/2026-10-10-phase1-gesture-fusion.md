# Phase 1 — Two-Hand Gesture Fusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser app where the Mac webcam tracks both hands; you grip (pinch or fist) website logos, pull new ones from edge shelves, and bring two center logos together to "fuse" them into a placeholder result card.

**Architecture:** Plain Vite + TypeScript, no UI framework, one canvas. A per-frame pipeline: `HandTracker` (MediaPipe → smoothed screen-space landmarks with stable ids) → `GestureEngine` (pure: landmarks → cursors + grip events) → `Scene` (pure state machine: shelves, slots, held logos, fuse) → `Renderer` (canvas, read-only). `MouseHand` emits the same input shape as `GestureEngine` for camera-less dev. The fuse result comes from a `FuseClient` interface; Phase 1 uses a placeholder.

**Tech Stack:** Vite, TypeScript (strict), Vitest, `@mediapipe/tasks-vision` (HandLandmarker), `simple-icons`.

**Spec:** `docs/superpowers/specs/2026-10-10-fuse-web-design.md`

**Public repo rules (apply to every task):** no API keys, no `.env` files, no personal or internal names/paths in code, comments, or commits. Commit locally; **do not push** — the owner pushes after review.

---

## File structure

```
package.json, tsconfig.json, vite.config.ts, index.html, README.md
scripts/copy-mediapipe-wasm.mjs   copies MediaPipe wasm into public/ on install
src/
  main.ts                 wiring + render loop (only file touching camera + DOM ids)
  style.css
  types.ts                Point, Landmarks, TrackedHand, HandCursor, GripEvent, InputFrame, Site
  config.ts               gripConfig, sceneConfig (mutable, tuned live by DebugPanel)
  data/sites.ts           12 sites from simple-icons
  tracking/oneEuro.ts     One Euro smoothing filter
  tracking/coords.ts      cover-fit rect + normalized → mirrored screen px
  tracking/assignIds.ts   stable hand ids by nearest wrist
  tracking/HandTracker.ts MediaPipe wrapper (uses the three above)
  gesture/grip.ts         pinch/fist ratios, cursor point
  gesture/fixtures.ts     synthetic hand poses for tests
  gesture/GestureEngine.ts grip hysteresis → cursors + events
  input/MouseHand.ts      mouse as a hand
  scene/layout.ts         positions/radii from viewport size
  scene/Scene.ts          all interaction state + rules
  fuse/FuseClient.ts      FuseClient interface + PlaceholderFuseClient
  render/logoImages.ts    simple-icons path → <img> glyph
  render/Renderer.ts      canvas drawing
  debug/DebugPanel.ts     D toggles panel, [ ] - = tune thresholds, R records landmarks
  **/*.test.ts            Vitest, colocated
```

---

### Task 1: Scaffold the project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/style.css`, `src/main.ts`, `scripts/copy-mediapipe-wasm.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "fuse-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "postinstall": "node scripts/copy-mediapipe-wasm.mjs"
  }
}
```

- [ ] **Step 2: Write `scripts/copy-mediapipe-wasm.mjs`**

```js
// Copies MediaPipe's wasm runtime into public/ so the app can load it locally.
import { cpSync, existsSync, mkdirSync } from 'node:fs'

const src = 'node_modules/@mediapipe/tasks-vision/wasm'
if (existsSync(src)) {
  mkdirSync('public', { recursive: true })
  cpSync(src, 'public/mediapipe-wasm', { recursive: true })
}
```

- [ ] **Step 3: Install dependencies**

Run:
```bash
npm install -D vite typescript vitest
npm install @mediapipe/tasks-vision simple-icons
ls public/mediapipe-wasm
```
Expected: `ls` lists `vision_wasm_internal.js` and `vision_wasm_internal.wasm` (plus nosimd variants).

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 5: Write `vite.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 6: Write `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>fuse-web</title>
  </head>
  <body>
    <video id="camera" playsinline muted></video>
    <canvas id="stage"></canvas>
    <div id="banner" hidden></div>
    <div id="hint" hidden>Show both hands — pinch or make a fist to grab</div>
    <pre id="debug" hidden></pre>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 7: Write `src/style.css`**

```css
[hidden] { display: none !important; }

html, body {
  margin: 0;
  height: 100%;
  overflow: hidden;
  background: #0b0b10;
  color: #f4f4f6;
  font-family: system-ui, -apple-system, sans-serif;
}

/* the video is only a source for drawing; keep it rendered but invisible */
#camera {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

#stage { display: block; touch-action: none; }

#banner {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 16px;
  border-radius: 10px;
  background: rgba(220, 60, 60, 0.9);
  font-size: 14px;
}

#hint {
  position: fixed;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 18px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  font-size: 16px;
}

#debug {
  position: fixed;
  top: 12px;
  left: 12px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.7);
  font: 12px/1.5 ui-monospace, monospace;
  pointer-events: none;
}
```

- [ ] **Step 8: Write a temporary `src/main.ts`**

```ts
import './style.css'

document.querySelector<HTMLElement>('#hint')!.hidden = false
```

- [ ] **Step 9: Ignore the copied wasm**

Append to `.gitignore`:
```
# copied from node_modules on install
public/mediapipe-wasm/
```

- [ ] **Step 10: Verify**

Run: `npm run typecheck && npm test`
Expected: both exit 0 (vitest prints "No test files found").

Run: `npm run dev`, open http://localhost:5173
Expected: dark page with the hint pill at the bottom. Stop the server.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src scripts .gitignore
git commit -m "chore: scaffold Vite + TS app"
```

---

### Task 2: Shared types and config

**Files:**
- Create: `src/types.ts`, `src/config.ts`

- [ ] **Step 1: Write `src/types.ts`**

```ts
export interface Point {
  x: number
  y: number
}

/** 21 hand landmarks in screen pixels, already mirrored. Indices follow MediaPipe. */
export type Landmarks = Point[]

export interface TrackedHand {
  id: number
  landmarks: Landmarks
}

export type GripKind = 'pinch' | 'fist'

export interface HandCursor {
  handId: number
  point: Point
  gripping: boolean
  /** live ratios for the debug panel; absent for the mouse */
  pinchRatio?: number
  fistRatio?: number
}

export type GripEvent =
  | { type: 'gripStart'; handId: number; point: Point }
  | { type: 'gripEnd'; handId: number; point: Point }

/** What one input source produces per frame. Hands and mouse both emit this. */
export interface InputFrame {
  cursors: HandCursor[]
  events: GripEvent[]
}

export interface Site {
  id: string
  name: string
  url: string
  /** brand color as #RRGGBB */
  color: string
  /** SVG path data in a 24×24 viewBox */
  iconPath: string
}
```

- [ ] **Step 2: Write `src/config.ts`**

```ts
/** Grip thresholds. Mutable on purpose: the debug panel tunes them live. */
export const gripConfig = {
  /** pinch when thumb–index distance < this × hand scale */
  pinchThreshold: 0.3,
  /** fist when mean fingertip–wrist distance < this × hand scale */
  fistThreshold: 0.9,
  /** release only above threshold × this */
  releaseFactor: 1.3,
  /** consecutive frames below threshold to start a grip */
  startFrames: 2,
  /** consecutive frames above release threshold to end a grip */
  endFrames: 3,
  /** frames a hand may vanish before its grip is dropped */
  lostGraceFrames: 10,
}
export type GripConfig = typeof gripConfig

export const sceneConfig = {
  /** hover/grab radius = logo radius × this */
  hoverFactor: 1.3,
  /** two held logos fuse when closer than this × slot diameter */
  fuseDistanceFactor: 1.2,
  /** spring follow rate, per second */
  followStiffness: 18,
  /** fly-back animation length */
  returnMs: 300,
  /** fraction of width at each edge where dropping the result card dismisses it */
  dismissEdge: 0.15,
  /** held logos render this much bigger */
  heldScale: 1.1,
}
export type SceneConfig = typeof sceneConfig
```

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck`
Expected: exit 0.

```bash
git add src/types.ts src/config.ts
git commit -m "feat: shared types and tunable config"
```

---

### Task 3: Grip math

**Files:**
- Create: `src/gesture/grip.ts`, `src/gesture/fixtures.ts`
- Test: `src/gesture/grip.test.ts`

- [ ] **Step 1: Write test fixtures `src/gesture/fixtures.ts`**

```ts
import type { Landmarks, Point } from '../types'

// Offsets in units of hand scale (wrist #0 → middle MCP #9 = 1), y up is negative.
const BASE: Record<number, [number, number]> = {
  0: [0, 0],
  5: [-0.35, -0.9],
  9: [0, -1],
  13: [0.3, -0.95],
  17: [0.55, -0.8],
}

const POSES: Record<'open' | 'pinch' | 'fist', Record<number, [number, number]>> = {
  open: { 4: [-0.9, -0.8], 8: [-0.4, -1.9], 12: [0, -2], 16: [0.3, -1.9], 20: [0.6, -1.6] },
  pinch: { 4: [-0.35, -1.3], 8: [-0.4, -1.35], 12: [0, -2], 16: [0.3, -1.9], 20: [0.6, -1.6] },
  fist: { 4: [0.1, -0.75], 8: [-0.3, -0.6], 12: [0, -0.6], 16: [0.25, -0.6], 20: [0.45, -0.55] },
}

/** A synthetic hand centered on its wrist at (cx, cy), hand scale s px. */
export function makeHand(pose: 'open' | 'pinch' | 'fist', cx = 500, cy = 400, s = 100): Landmarks {
  const lm: Point[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy - s }))
  for (const [i, [dx, dy]] of Object.entries({ ...BASE, ...POSES[pose] })) {
    lm[Number(i)] = { x: cx + dx * s, y: cy + dy * s }
  }
  return lm
}

/** An open hand whose thumb tip sits exactly `ratio` hand-scales right of the index tip. */
export function withPinchRatio(ratio: number, cx = 500, cy = 400, s = 100): Landmarks {
  const lm = makeHand('open', cx, cy, s)
  lm[4] = { x: lm[8].x + ratio * s, y: lm[8].y }
  return lm
}
```

- [ ] **Step 2: Write the failing test `src/gesture/grip.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { cursorPoint, fistRatio, handScale, pinchRatio } from './grip'
import { makeHand, withPinchRatio } from './fixtures'

describe('grip math', () => {
  it('hand scale is wrist to middle MCP', () => {
    expect(handScale(makeHand('open', 500, 400, 80))).toBeCloseTo(80)
  })

  it('open hand: neither pinch nor fist', () => {
    const lm = makeHand('open')
    expect(pinchRatio(lm)).toBeGreaterThan(1)
    expect(fistRatio(lm)).toBeGreaterThan(1.5)
  })

  it('pinch pose has a small pinch ratio', () => {
    expect(pinchRatio(makeHand('pinch'))).toBeLessThan(0.1)
  })

  it('fist pose has a small fist ratio and no pinch', () => {
    const lm = makeHand('fist')
    expect(fistRatio(lm)).toBeLessThan(0.8)
    expect(pinchRatio(lm)).toBeGreaterThan(0.3)
  })

  it('ratios do not depend on distance from camera', () => {
    expect(pinchRatio(withPinchRatio(0.25, 500, 400, 50))).toBeCloseTo(0.25)
    expect(pinchRatio(withPinchRatio(0.25, 500, 400, 200))).toBeCloseTo(0.25)
  })

  it('pinch cursor is the thumb–index midpoint', () => {
    const lm = makeHand('pinch')
    expect(cursorPoint(lm, 'pinch')).toEqual({ x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 })
  })

  it('fist cursor is the palm center', () => {
    const p = cursorPoint(makeHand('fist'), 'fist')
    expect(p.x).toBeCloseTo(510)
    expect(p.y).toBeCloseTo(327)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/gesture/grip.test.ts`
Expected: FAIL — cannot resolve `./grip`.

- [ ] **Step 4: Write `src/gesture/grip.ts`**

```ts
import type { GripKind, Landmarks, Point } from '../types'

export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

const FINGERTIPS = [8, 12, 16, 20]
const PALM = [0, 5, 9, 13, 17]

/** Wrist → middle MCP. Normalizes every ratio so it works at any camera distance. */
export function handScale(lm: Landmarks): number {
  return Math.max(dist(lm[0], lm[9]), 1e-6)
}

export function pinchRatio(lm: Landmarks): number {
  return dist(lm[4], lm[8]) / handScale(lm)
}

export function fistRatio(lm: Landmarks): number {
  const total = FINGERTIPS.reduce((sum, i) => sum + dist(lm[i], lm[0]), 0)
  return total / FINGERTIPS.length / handScale(lm)
}

export function cursorPoint(lm: Landmarks, kind: GripKind): Point {
  if (kind === 'pinch') return { x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 }
  const x = PALM.reduce((sum, i) => sum + lm[i].x, 0) / PALM.length
  const y = PALM.reduce((sum, i) => sum + lm[i].y, 0) / PALM.length
  return { x, y }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/gesture/grip.test.ts`
Expected: 7 passed.

- [ ] **Step 6: Commit**

```bash
git add src/gesture
git commit -m "feat: pinch/fist grip math"
```

---

### Task 4: GestureEngine (hysteresis → events)

**Files:**
- Create: `src/gesture/GestureEngine.ts`
- Test: `src/gesture/GestureEngine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { gripConfig } from '../config'
import type { Landmarks } from '../types'
import { GestureEngine } from './GestureEngine'
import { makeHand, withPinchRatio } from './fixtures'

const engine = () => new GestureEngine({ ...gripConfig, lostGraceFrames: 3 })
const hand = (landmarks: Landmarks, id = 1) => ({ id, landmarks })

describe('GestureEngine', () => {
  it('open hand reports a non-gripping cursor and no events', () => {
    const out = engine().update([hand(makeHand('open'))])
    expect(out.events).toEqual([])
    expect(out.cursors).toHaveLength(1)
    expect(out.cursors[0].gripping).toBe(false)
  })

  it('pinch must hold for startFrames before gripStart', () => {
    const e = engine()
    expect(e.update([hand(makeHand('pinch'))]).events).toEqual([])
    const second = e.update([hand(makeHand('pinch'))])
    expect(second.events).toHaveLength(1)
    expect(second.events[0]).toMatchObject({ type: 'gripStart', handId: 1 })
    expect(second.cursors[0].gripping).toBe(true)
  })

  it('a one-frame pinch blip does not grip', () => {
    const e = engine()
    e.update([hand(makeHand('pinch'))])
    expect(e.update([hand(makeHand('open'))]).events).toEqual([])
    expect(e.update([hand(makeHand('open'))]).events).toEqual([])
  })

  it('release needs ratio above threshold × releaseFactor for endFrames', () => {
    const e = engine()
    e.update([hand(withPinchRatio(0.1))])
    e.update([hand(withPinchRatio(0.1))])
    for (let i = 0; i < 5; i++) {
      // 0.35 is above 0.30 but below 0.39: still gripping
      expect(e.update([hand(withPinchRatio(0.35))]).events).toEqual([])
    }
    expect(e.update([hand(withPinchRatio(0.5))]).events).toEqual([])
    expect(e.update([hand(withPinchRatio(0.5))]).events).toEqual([])
    const third = e.update([hand(withPinchRatio(0.5))])
    expect(third.events).toEqual([expect.objectContaining({ type: 'gripEnd', handId: 1 })])
  })

  it('fist grips with the palm center as cursor', () => {
    const e = engine()
    e.update([hand(makeHand('fist'))])
    const out = e.update([hand(makeHand('fist'))])
    expect(out.events[0].type).toBe('gripStart')
    expect(out.events[0].point.x).toBeCloseTo(510)
    expect(out.events[0].point.y).toBeCloseTo(327)
  })

  it('tracks two hands independently', () => {
    const e = engine()
    e.update([hand(makeHand('pinch', 300), 1), hand(makeHand('open', 700), 2)])
    const out = e.update([hand(makeHand('pinch', 300), 1), hand(makeHand('open', 700), 2)])
    expect(out.events).toEqual([expect.objectContaining({ type: 'gripStart', handId: 1 })])
    expect(out.cursors.map((c) => [c.handId, c.gripping])).toEqual([[1, true], [2, false]])
  })

  it('keeps a lost hand gripping during the grace period, then ends the grip', () => {
    const e = engine()
    e.update([hand(makeHand('pinch'))])
    e.update([hand(makeHand('pinch'))])
    for (let i = 0; i < 3; i++) {
      const out = e.update([])
      expect(out.events).toEqual([])
      expect(out.cursors[0]).toMatchObject({ handId: 1, gripping: true })
    }
    const out = e.update([])
    expect(out.events).toEqual([expect.objectContaining({ type: 'gripEnd', handId: 1 })])
    expect(out.cursors).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/gesture/GestureEngine.test.ts`
Expected: FAIL — cannot resolve `./GestureEngine`.

- [ ] **Step 3: Write `src/gesture/GestureEngine.ts`**

```ts
import { gripConfig as defaultConfig, type GripConfig } from '../config'
import type { GripEvent, GripKind, HandCursor, InputFrame, Point, TrackedHand } from '../types'
import { cursorPoint, fistRatio, pinchRatio } from './grip'

interface HandState {
  gripping: boolean
  kind: GripKind
  startCount: number
  endCount: number
  lostCount: number
  point: Point
}

/** Turns tracked hands into cursors + grip events. Pure apart from per-hand memory. */
export class GestureEngine {
  private states = new Map<number, HandState>()

  constructor(private config: GripConfig = defaultConfig) {}

  update(hands: TrackedHand[]): InputFrame {
    const c = this.config
    const cursors: HandCursor[] = []
    const events: GripEvent[] = []
    const seen = new Set<number>()

    for (const hand of hands) {
      seen.add(hand.id)
      const lm = hand.landmarks
      const pinch = pinchRatio(lm)
      const fist = fistRatio(lm)
      let s = this.states.get(hand.id)
      if (!s) {
        s = { gripping: false, kind: 'pinch', startCount: 0, endCount: 0, lostCount: 0, point: cursorPoint(lm, 'pinch') }
        this.states.set(hand.id, s)
      }
      s.lostCount = 0

      if (!s.gripping) {
        const candidate: GripKind | null =
          pinch < c.pinchThreshold ? 'pinch' : fist < c.fistThreshold ? 'fist' : null
        s.startCount = candidate ? s.startCount + 1 : 0
        if (candidate) s.kind = candidate
        s.point = cursorPoint(lm, candidate ?? 'pinch')
        if (candidate && s.startCount >= c.startFrames) {
          s.gripping = true
          s.endCount = 0
          events.push({ type: 'gripStart', handId: hand.id, point: s.point })
        }
      } else {
        const released =
          s.kind === 'pinch' ? pinch > c.pinchThreshold * c.releaseFactor : fist > c.fistThreshold * c.releaseFactor
        s.endCount = released ? s.endCount + 1 : 0
        s.point = cursorPoint(lm, s.kind)
        if (s.endCount >= c.endFrames) {
          s.gripping = false
          s.startCount = 0
          events.push({ type: 'gripEnd', handId: hand.id, point: s.point })
        }
      }
      cursors.push({ handId: hand.id, point: s.point, gripping: s.gripping, pinchRatio: pinch, fistRatio: fist })
    }

    for (const [id, s] of this.states) {
      if (seen.has(id)) continue
      s.lostCount++
      if (s.lostCount <= c.lostGraceFrames) {
        cursors.push({ handId: id, point: s.point, gripping: s.gripping })
        continue
      }
      if (s.gripping) events.push({ type: 'gripEnd', handId: id, point: s.point })
      this.states.delete(id)
    }

    return { cursors, events }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/gesture/GestureEngine.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/gesture/GestureEngine.ts src/gesture/GestureEngine.test.ts
git commit -m "feat: GestureEngine with grip hysteresis and lost-hand grace"
```

---

### Task 5: One Euro filter

**Files:**
- Create: `src/tracking/oneEuro.ts`
- Test: `src/tracking/oneEuro.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { OneEuroFilter } from './oneEuro'

const FRAME = 1000 / 60

describe('OneEuroFilter', () => {
  it('passes the first value through', () => {
    expect(new OneEuroFilter().filter(42, 0)).toBe(42)
  })

  it('keeps a constant signal constant', () => {
    const f = new OneEuroFilter()
    for (let i = 0; i < 30; i++) expect(f.filter(10, i * FRAME)).toBeCloseTo(10)
  })

  it('smooths a step, then converges', () => {
    const f = new OneEuroFilter()
    f.filter(0, 0)
    const first = f.filter(100, FRAME)
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(100)
    let v = first
    for (let i = 2; i <= 60; i++) v = f.filter(100, i * FRAME)
    expect(v).toBeGreaterThan(99)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tracking/oneEuro.test.ts`
Expected: FAIL — cannot resolve `./oneEuro`.

- [ ] **Step 3: Write `src/tracking/oneEuro.ts`**

```ts
/**
 * One Euro filter (Casiez et al. 2012): heavy smoothing when still, light when moving fast.
 * Units: value in px, time in ms. beta is tuned for px/s speeds.
 */
export class OneEuroFilter {
  private xPrev: number | null = null
  private dxPrev = 0
  private tPrev = 0

  constructor(
    private minCutoff = 1.5,
    private beta = 0.02,
    private dCutoff = 1,
  ) {}

  filter(x: number, tMs: number): number {
    if (this.xPrev === null) {
      this.xPrev = x
      this.tPrev = tMs
      return x
    }
    const dt = Math.max((tMs - this.tPrev) / 1000, 1e-3)
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt)
    const dx = (x - this.xPrev) / dt
    const dxHat = this.dxPrev + alpha(this.dCutoff) * (dx - this.dxPrev)
    const xHat = this.xPrev + alpha(this.minCutoff + this.beta * Math.abs(dxHat)) * (x - this.xPrev)
    this.xPrev = xHat
    this.dxPrev = dxHat
    this.tPrev = tMs
    return xHat
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tracking/oneEuro.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/tracking/oneEuro.ts src/tracking/oneEuro.test.ts
git commit -m "feat: One Euro smoothing filter"
```

---

### Task 6: Screen coordinates and stable hand ids

**Files:**
- Create: `src/tracking/coords.ts`, `src/tracking/assignIds.ts`
- Test: `src/tracking/coords.test.ts`, `src/tracking/assignIds.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/tracking/coords.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { coverRect, toScreen } from './coords'

describe('coords', () => {
  it('cover-fits a 16:9 video into a square viewport', () => {
    const r = coverRect(1280, 720, 1000, 1000)
    expect(r.w).toBeCloseTo(1777.78, 1)
    expect(r.h).toBeCloseTo(1000)
    expect(r.x).toBeCloseTo(-388.89, 1)
    expect(r.y).toBeCloseTo(0)
  })

  it('maps the video center to the viewport center', () => {
    const r = coverRect(1280, 720, 1000, 1000)
    const p = toScreen(0.5, 0.5, r, 1000)
    expect(p.x).toBeCloseTo(500)
    expect(p.y).toBeCloseTo(500)
  })

  it('mirrors: the left edge of the video lands on the right', () => {
    const r = coverRect(1280, 720, 1000, 1000)
    expect(toScreen(0, 0, r, 1000).x).toBeCloseTo(1388.89, 1)
  })
})
```

`src/tracking/assignIds.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { assignIds } from './assignIds'

describe('assignIds', () => {
  it('gives new hands fresh ids', () => {
    expect(assignIds([], [{ x: 0, y: 0 }, { x: 500, y: 0 }], 1, 200)).toEqual({ ids: [1, 2], nextId: 3 })
  })

  it('matches each hand to the nearest previous wrist regardless of order', () => {
    const prev = [
      { id: 1, wrist: { x: 100, y: 100 } },
      { id: 2, wrist: { x: 800, y: 100 } },
    ]
    const out = assignIds(prev, [{ x: 790, y: 110 }, { x: 110, y: 95 }], 3, 200)
    expect(out).toEqual({ ids: [2, 1], nextId: 3 })
  })

  it('treats a jump beyond maxJump as a new hand', () => {
    const prev = [{ id: 1, wrist: { x: 100, y: 100 } }]
    expect(assignIds(prev, [{ x: 900, y: 900 }], 3, 200)).toEqual({ ids: [3], nextId: 4 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tracking`
Expected: FAIL — cannot resolve `./coords` and `./assignIds` (oneEuro still passes).

- [ ] **Step 3: Write `src/tracking/coords.ts`**

```ts
import type { Point } from '../types'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Where a srcW×srcH video lands when drawn "object-fit: cover" into dstW×dstH. */
export function coverRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  const s = Math.max(dstW / srcW, dstH / srcH)
  const w = srcW * s
  const h = srcH * s
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h }
}

/** MediaPipe normalized coords → screen px, matching a cover-fit video mirrored about the viewport. */
export function toScreen(nx: number, ny: number, rect: Rect, dstW: number): Point {
  return { x: dstW - (rect.x + nx * rect.w), y: rect.y + ny * rect.h }
}
```

- [ ] **Step 4: Write `src/tracking/assignIds.ts`**

```ts
import type { Point } from '../types'

export interface PrevHand {
  id: number
  wrist: Point
}

/** Greedy nearest-wrist matching. MediaPipe's left/right label flips too often to use as an id. */
export function assignIds(
  prev: PrevHand[],
  wrists: Point[],
  nextId: number,
  maxJump: number,
): { ids: number[]; nextId: number } {
  const ids = new Array<number>(wrists.length).fill(-1)
  const pairs: { i: number; j: number; d: number }[] = []
  wrists.forEach((w, i) =>
    prev.forEach((p, j) => {
      const d = Math.hypot(w.x - p.wrist.x, w.y - p.wrist.y)
      if (d <= maxJump) pairs.push({ i, j, d })
    }),
  )
  pairs.sort((a, b) => a.d - b.d)
  const usedPrev = new Set<number>()
  for (const { i, j } of pairs) {
    if (ids[i] !== -1 || usedPrev.has(j)) continue
    ids[i] = prev[j].id
    usedPrev.add(j)
  }
  for (let i = 0; i < ids.length; i++) if (ids[i] === -1) ids[i] = nextId++
  return { ids, nextId }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/tracking`
Expected: 9 passed.

- [ ] **Step 6: Commit**

```bash
git add src/tracking
git commit -m "feat: mirrored cover-fit coords and stable hand ids"
```

---

### Task 7: HandTracker (MediaPipe wrapper)

No unit test — it needs a real camera and GPU. It's exercised in Task 15's manual check; its pure parts are already tested.

**Files:**
- Create: `src/tracking/HandTracker.ts`

- [ ] **Step 1: Write `src/tracking/HandTracker.ts`**

```ts
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import type { Point, TrackedHand } from '../types'
import { assignIds, type PrevHand } from './assignIds'
import { coverRect, toScreen } from './coords'
import { OneEuroFilter } from './oneEuro'

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
/** keep a vanished hand's id this many video frames so a brief dropout doesn't reset it */
const KEEP_LOST_FRAMES = 6

export class HandTracker {
  private filters = new Map<number, OneEuroFilter[]>()
  private known: (PrevHand & { lastFrame: number })[] = []
  private nextId = 1
  private frame = 0
  private lastVideoTime = -1
  private lastHands: TrackedHand[] = []

  private constructor(private landmarker: HandLandmarker) {}

  static async create(): Promise<HandTracker> {
    const fileset = await FilesetResolver.forVisionTasks('/mediapipe-wasm')
    const landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
    })
    return new HandTracker(landmarker)
  }

  /** Hands in mirrored screen px. Returns the previous result if the video has no new frame. */
  detect(video: HTMLVideoElement, nowMs: number, viewW: number, viewH: number): TrackedHand[] {
    if (video.readyState < 2 || video.currentTime === this.lastVideoTime) return this.lastHands
    this.lastVideoTime = video.currentTime
    this.frame++

    const result = this.landmarker.detectForVideo(video, nowMs)
    const rect = coverRect(video.videoWidth, video.videoHeight, viewW, viewH)
    const raw = result.landmarks.map((hand) => hand.map((l) => toScreen(l.x, l.y, rect, viewW)))
    const { ids, nextId } = assignIds(this.known, raw.map((lm) => lm[0]), this.nextId, Math.max(viewW, viewH) * 0.2)
    this.nextId = nextId
    const hands = raw.map((lm, i) => ({ id: ids[i], landmarks: this.smooth(ids[i], lm, nowMs) }))

    for (const h of hands) {
      const k = this.known.find((k) => k.id === h.id)
      if (k) {
        k.wrist = h.landmarks[0]
        k.lastFrame = this.frame
      } else {
        this.known.push({ id: h.id, wrist: h.landmarks[0], lastFrame: this.frame })
      }
    }
    this.known = this.known.filter((k) => this.frame - k.lastFrame <= KEEP_LOST_FRAMES)
    for (const id of [...this.filters.keys()]) {
      if (!this.known.some((k) => k.id === id)) this.filters.delete(id)
    }

    this.lastHands = hands
    return hands
  }

  private smooth(id: number, lm: Point[], tMs: number): Point[] {
    let f = this.filters.get(id)
    if (!f) {
      f = Array.from({ length: lm.length * 2 }, () => new OneEuroFilter())
      this.filters.set(id, f)
    }
    const filters = f
    return lm.map((p, i) => ({ x: filters[2 * i].filter(p.x, tMs), y: filters[2 * i + 1].filter(p.y, tMs) }))
  }
}
```

- [ ] **Step 2: Verify and commit**

Run: `npm run typecheck`
Expected: exit 0.

```bash
git add src/tracking/HandTracker.ts
git commit -m "feat: HandTracker wrapping MediaPipe HandLandmarker"
```

---

### Task 8: Layout

**Files:**
- Create: `src/scene/layout.ts`
- Test: `src/scene/layout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { computeLayout } from './layout'

describe('computeLayout', () => {
  const L = computeLayout(1000, 600, 6)

  it('sizes logos from the short side', () => {
    expect(L.shelfRadius).toBe(30)
    expect(L.slotRadius).toBe(72)
    expect(L.cardRadius).toBe(108)
  })

  it('places two center slots at 30% and 70% width', () => {
    expect(L.slots).toEqual([{ x: 300, y: 300 }, { x: 700, y: 300 }])
    expect(L.center).toEqual({ x: 500, y: 300 })
  })

  it('spreads shelves evenly down each edge', () => {
    expect(L.shelf.left).toHaveLength(6)
    expect(L.shelf.left[0].x).toBeCloseTo(48)
    expect(L.shelf.left[0].y).toBeCloseTo(600 / 7)
    expect(L.shelf.right[5].x).toBeCloseTo(952)
    expect(L.shelf.right[5].y).toBeCloseTo((600 * 6) / 7)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/scene/layout.test.ts`
Expected: FAIL — cannot resolve `./layout`.

- [ ] **Step 3: Write `src/scene/layout.ts`**

```ts
import type { Point } from '../types'

export type Side = 'left' | 'right'

export interface Layout {
  width: number
  height: number
  shelfRadius: number
  slotRadius: number
  cardRadius: number
  shelf: Record<Side, Point[]>
  slots: [Point, Point]
  center: Point
}

export function computeLayout(width: number, height: number, perShelf: number): Layout {
  const short = Math.min(width, height)
  const shelfRadius = Math.round(short * 0.05)
  const slotRadius = Math.round(short * 0.12)
  const inset = Math.round(shelfRadius * 1.6)
  const ys = Array.from({ length: perShelf }, (_, i) => (height * (i + 1)) / (perShelf + 1))
  return {
    width,
    height,
    shelfRadius,
    slotRadius,
    cardRadius: Math.round(slotRadius * 1.5),
    shelf: {
      left: ys.map((y) => ({ x: inset, y })),
      right: ys.map((y) => ({ x: width - inset, y })),
    },
    slots: [
      { x: width * 0.3, y: height / 2 },
      { x: width * 0.7, y: height / 2 },
    ],
    center: { x: width / 2, y: height / 2 },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/scene/layout.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/scene/layout.ts src/scene/layout.test.ts
git commit -m "feat: viewport layout for shelves, slots and card"
```

---

### Task 9: FuseClient

Comes before Scene because Scene imports `FuseResult`.

**Files:**
- Create: `src/fuse/FuseClient.ts`
- Test: `src/fuse/FuseClient.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import type { Site } from '../types'
import { PlaceholderFuseClient } from './FuseClient'

const site = (id: string, name: string): Site => ({ id, name, url: `https://${id}.com`, color: '#000000', iconPath: '' })

describe('PlaceholderFuseClient', () => {
  it('resolves a labelled result for the pair', async () => {
    const r = await new PlaceholderFuseClient(0).fuse(site('spotify', 'Spotify'), site('airbnb', 'Airbnb'))
    expect(r).toEqual({ siteA: 'spotify', siteB: 'airbnb', label: 'Spotify × Airbnb' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/fuse`
Expected: FAIL — cannot resolve `./FuseClient`.

- [ ] **Step 3: Write `src/fuse/FuseClient.ts`**

```ts
import type { Site } from '../types'

export interface FuseResult {
  siteA: string
  siteB: string
  label: string
  /** Phase 2: fused logo image */
  logoUrl?: string
  /** Phase 3: fused landing page */
  pageUrl?: string
}

export interface FuseClient {
  fuse(a: Site, b: Site): Promise<FuseResult>
}

/** Phase 1 stand-in: no backend, just a short "thinking" delay. */
export class PlaceholderFuseClient implements FuseClient {
  constructor(private delayMs = 1200) {}

  async fuse(a: Site, b: Site): Promise<FuseResult> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs))
    return { siteA: a.id, siteB: b.id, label: `${a.name} × ${b.name}` }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/fuse`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/fuse
git commit -m "feat: FuseClient interface with placeholder client"
```

---

### Task 10: Scene — hover, grab, drop, pull from shelf

**Files:**
- Create: `src/scene/Scene.ts`
- Test: `src/scene/Scene.test.ts`

- [ ] **Step 1: Write the failing test `src/scene/Scene.test.ts`**

Layout at 1000×600 (from Task 8): slots at (300,300) and (700,300), slotRadius 72, shelfRadius 30, left shelf x=48, right shelf x=952, shelf row y = 600·(i+1)/7.

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/scene/Scene.test.ts`
Expected: FAIL — cannot resolve `./Scene`.

- [ ] **Step 3: Write `src/scene/Scene.ts`**

This is the full Scene, including fuse logic; Task 11 adds the fuse tests.

```ts
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
  onFuse: (a: Site, b: Site) => void
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
  private readonly onFuse: (a: Site, b: Site) => void
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
      if (c) h.target = c.point
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
      if (!this.isSlotHeld(slot) && near(L.slots[slot], L.slotRadius)) return { kind: 'slot', slot }
    }
    for (const side of SIDES) {
      const index = L.shelf[side].findIndex((c) => near(c, L.shelfRadius))
      if (index !== -1) return { kind: 'shelf', side, index }
    }
    return null
  }

  setFuseResult(result: FuseResult): void {
    const f = this.fuse
    if (f && f.siteA === result.siteA && f.siteB === result.siteB) {
      f.status = 'done'
      f.result = result
    }
  }

  setFuseError(siteA: string, siteB: string): void {
    const f = this.fuse
    if (f && f.siteA === siteA && f.siteB === siteB) f.status = 'error'
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
    this.held.set(e.handId, { handId: e.handId, siteId, from: hit, pos: { ...this.itemPos(hit) }, target: e.point })
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
    this.fuse = { siteA: a, siteB: b, status: 'fusing', startedAt: this.now, result: null, at: { ...at } }
    this.onFuse(this.site(a), this.site(b))
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
      this.onFuse(this.site(f.siteA), this.site(f.siteB))
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/scene/Scene.test.ts`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add src/scene/Scene.ts src/scene/Scene.test.ts
git commit -m "feat: Scene with hover, grab, drop and shelf pulls"
```

---

### Task 11: Scene — fuse and result card

**Files:**
- Modify: `src/scene/Scene.test.ts` (append a second `describe`)

- [ ] **Step 1: Append fuse tests to `src/scene/Scene.test.ts`**

```ts
describe('Scene fuse', () => {
  it('two hands holding the slot logos fuse when brought together', () => {
    const { scene, onFuse, step } = setup()
    step([cur(1, 300, 300, true), cur(2, 700, 300, true)], [start(1, 300, 300), start(2, 700, 300)])
    expect(scene.held.size).toBe(2)
    expect(onFuse).not.toHaveBeenCalled()
    step([cur(1, 480, 300, true), cur(2, 520, 300, true)])
    expect(onFuse).toHaveBeenCalledTimes(1)
    expect(onFuse.mock.calls[0].map((s: Site) => s.id)).toEqual(['s0', 's6'])
    expect(scene.fuse).toMatchObject({ siteA: 's0', siteB: 's6', status: 'fusing' })
    expect(scene.held.size).toBe(0)
  })

  it('two held logos far apart do not fuse', () => {
    const { scene, onFuse, step } = setup()
    step([cur(1, 300, 300, true), cur(2, 700, 300, true)], [start(1, 300, 300), start(2, 700, 300)])
    step([cur(1, 350, 200, true), cur(2, 650, 400, true)])
    expect(onFuse).not.toHaveBeenCalled()
    expect(scene.fuse).toBeNull()
  })

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

  it('the card glides to center, shows the result, and is dismissed at an edge', () => {
    const { scene, step } = setup()
    step([cur(1, 300, 300, true)], [start(1, 300, 300)])
    step([cur(1, 700, 300)], [end(1, 700, 300)])
    step([])
    expect(scene.fuse?.at).toEqual({ x: 500, y: 300 })
    scene.setFuseResult({ siteA: 's0', siteB: 's6', label: 'Site 0 × Site 6' })
    expect(scene.fuse?.status).toBe('done')

    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    expect(scene.held.get(1)?.from).toEqual({ kind: 'card' })
    step([cur(1, 50, 300, true)])
    step([cur(1, 50, 300)], [end(1, 50, 300)])
    expect(scene.fuse).toBeNull()
    expect(scene.slots).toEqual(['s0', 's6'])
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
    scene.setFuseError('s0', 's6')
    expect(scene.fuse?.status).toBe('error')
    step([cur(1, 500, 300, true)], [start(1, 500, 300)])
    step([cur(1, 500, 300)], [end(1, 500, 300)])
    expect(onFuse).toHaveBeenCalledTimes(2)
    expect(scene.fuse?.status).toBe('fusing')
  })

  it('ignores a result for a pair that is no longer fusing', () => {
    const { scene } = setup()
    scene.setFuseResult({ siteA: 's0', siteB: 's6', label: 'x' })
    expect(scene.fuse).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/scene`
Expected: all pass (3 layout + 17 scene). The fuse logic was written in Task 10; if any fuse test fails, fix `Scene.ts` rather than the test, unless the test contradicts the spec rules.

- [ ] **Step 3: Commit**

```bash
git add src/scene/Scene.test.ts
git commit -m "test: Scene fuse and result card rules"
```

---

### Task 12: Site library

**Files:**
- Create: `src/data/sites.ts`
- Test: `src/data/sites.test.ts`

- [ ] **Step 1: Check which icons exist in the installed simple-icons**

Some brands get removed from simple-icons over time. Run:
```bash
node --input-type=module -e "import * as s from 'simple-icons'; for (const k of ['siSpotify','siStripe','siGithub','siDuolingo','siDiscord','siApple','siAirbnb','siNetflix','siNotion','siFigma','siUber','siReddit','siShopify','siTwitch','siDropbox','siYoutube']) console.log(k, Boolean(s[k]))"
```
Expected: `true` for the first 12. If any of the first 12 prints `false`, swap it in Step 3 for one of the spares (Shopify, Twitch, Dropbox, YouTube) that prints `true`, keeping the site's real homepage URL.

- [ ] **Step 2: Write the failing test `src/data/sites.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { PER_SHELF, SITES } from './sites'

describe('SITES', () => {
  it('fills both shelves', () => {
    expect(SITES).toHaveLength(PER_SHELF * 2)
  })

  it('has unique ids, hex colors and icon paths', () => {
    expect(new Set(SITES.map((s) => s.id)).size).toBe(SITES.length)
    for (const s of SITES) {
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(s.iconPath.length).toBeGreaterThan(10)
      expect(s.url).toMatch(/^https:\/\//)
    }
  })
})
```

- [ ] **Step 3: Write `src/data/sites.ts`**

```ts
import {
  siAirbnb,
  siApple,
  siDiscord,
  siDuolingo,
  siFigma,
  siGithub,
  siNetflix,
  siNotion,
  siReddit,
  siSpotify,
  siStripe,
  siUber,
  type SimpleIcon,
} from 'simple-icons'
import type { Site } from '../types'

export const PER_SHELF = 6

const site = (icon: SimpleIcon, url: string): Site => ({
  id: icon.slug,
  name: icon.title,
  url,
  color: `#${icon.hex}`,
  iconPath: icon.path,
})

/** First PER_SHELF go on the left shelf, the rest on the right. Slots start with the first of each. */
export const SITES: Site[] = [
  site(siSpotify, 'https://www.spotify.com'),
  site(siStripe, 'https://stripe.com'),
  site(siGithub, 'https://github.com'),
  site(siDuolingo, 'https://www.duolingo.com'),
  site(siDiscord, 'https://discord.com'),
  site(siApple, 'https://www.apple.com'),
  site(siAirbnb, 'https://www.airbnb.com'),
  site(siNetflix, 'https://www.netflix.com'),
  site(siNotion, 'https://www.notion.com'),
  site(siFigma, 'https://www.figma.com'),
  site(siUber, 'https://www.uber.com'),
  site(siReddit, 'https://www.reddit.com'),
]
```

If `type SimpleIcon` fails to import in Step 4's typecheck, replace it with `type SimpleIcon = typeof siSpotify`.

- [ ] **Step 4: Run test and typecheck**

Run: `npx vitest run src/data && npm run typecheck`
Expected: 2 passed; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/data
git commit -m "feat: 12-site library from simple-icons"
```

---

### Task 13: MouseHand

DOM-only adapter, verified manually in Task 15.

**Files:**
- Create: `src/input/MouseHand.ts`

- [ ] **Step 1: Write `src/input/MouseHand.ts`**

```ts
import type { GripEvent, HandCursor, InputFrame } from '../types'

/** HandTracker ids start at 1, so 0 is free for the mouse. */
export const MOUSE_HAND_ID = 0

/** The mouse as one hand: press = grip. Emits the same InputFrame shape as GestureEngine. */
export class MouseHand {
  private cursor: HandCursor | null = null
  private pending: GripEvent[] = []

  constructor(target: HTMLElement) {
    target.addEventListener('pointermove', (e) => this.move(e.clientX, e.clientY))
    target.addEventListener('pointerdown', (e) => {
      const c = this.move(e.clientX, e.clientY)
      c.gripping = true
      this.pending.push({ type: 'gripStart', handId: MOUSE_HAND_ID, point: { ...c.point } })
    })
    target.addEventListener('pointerup', (e) => this.release(e.clientX, e.clientY))
    target.addEventListener('pointerleave', (e) => {
      this.release(e.clientX, e.clientY)
      this.cursor = null
    })
  }

  poll(): InputFrame {
    const events = this.pending
    this.pending = []
    return { cursors: this.cursor ? [{ ...this.cursor, point: { ...this.cursor.point } }] : [], events }
  }

  private move(x: number, y: number): HandCursor {
    if (!this.cursor) this.cursor = { handId: MOUSE_HAND_ID, point: { x, y }, gripping: false }
    this.cursor.point = { x, y }
    return this.cursor
  }

  private release(x: number, y: number): void {
    if (!this.cursor?.gripping) return
    this.move(x, y).gripping = false
    this.pending.push({ type: 'gripEnd', handId: MOUSE_HAND_ID, point: { x, y } })
  }
}
```

- [ ] **Step 2: Verify and commit**

Run: `npm run typecheck`
Expected: exit 0.

```bash
git add src/input
git commit -m "feat: mouse as a fallback hand"
```

---

### Task 14: Renderer and logo glyphs

Canvas drawing; verified visually in Task 15.

**Files:**
- Create: `src/render/logoImages.ts`, `src/render/Renderer.ts`
- Test: `src/render/logoImages.test.ts`

- [ ] **Step 1: Write the failing test `src/render/logoImages.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { glyphColor } from './logoImages'

describe('glyphColor', () => {
  it('uses white on dark or saturated brand colors', () => {
    expect(glyphColor('#000000')).toBe('#ffffff')
    expect(glyphColor('#1ED760')).toBe('#ffffff')
    expect(glyphColor('#FF5A5F')).toBe('#ffffff')
  })

  it('uses black on very light brand colors', () => {
    expect(glyphColor('#FFFFFF')).toBe('#000000')
    expect(glyphColor('#FFFC00')).toBe('#000000')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/render`
Expected: FAIL — cannot resolve `./logoImages`.

- [ ] **Step 3: Write `src/render/logoImages.ts`**

```ts
import type { Site } from '../types'

/** White glyph unless the brand color is very light (relative luminance > 0.7). */
export function glyphColor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.7 ? '#000000' : '#ffffff'
}

/** The site's simple-icons glyph as an <img>, ready for canvas drawImage once loaded. */
export function glyphImage(site: Site): HTMLImageElement {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${glyphColor(site.color)}" d="${site.iconPath}"/></svg>`
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  return img
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/render`
Expected: 2 passed.

- [ ] **Step 5: Write `src/render/Renderer.ts`**

```ts
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
```

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test`
Expected: typecheck exit 0; all tests pass.

```bash
git add src/render
git commit -m "feat: canvas renderer with shelves, slots, flights and fuse card"
```

---

### Task 15: Debug panel, main loop, and live check

**Files:**
- Create: `src/debug/DebugPanel.ts`
- Modify: `src/main.ts` (replace entirely)

- [ ] **Step 1: Write `src/debug/DebugPanel.ts`**

```ts
import type { GripConfig } from '../config'
import type { HandCursor, TrackedHand } from '../types'

/**
 * D: toggle panel + landmark dots. [ / ]: pinch threshold −/+. - / =: fist threshold −/+.
 * R: start/stop recording landmarks; stopping downloads a JSON file usable as test fixtures.
 */
export class DebugPanel {
  visible = false
  private recording: TrackedHand[][] | null = null

  constructor(
    private el: HTMLElement,
    private config: GripConfig,
  ) {
    window.addEventListener('keydown', (e) => this.onKey(e.key))
  }

  record(hands: TrackedHand[]): void {
    this.recording?.push(
      hands.map((h) => ({ id: h.id, landmarks: h.landmarks.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) })),
    )
  }

  update(cursors: HandCursor[]): void {
    this.el.hidden = !this.visible
    if (!this.visible) return
    const c = this.config
    const lines = [
      `pinch < ${c.pinchThreshold.toFixed(2)}   fist < ${c.fistThreshold.toFixed(2)}   ${this.recording ? '● REC' : ''}`,
      ...cursors.map(
        (h) =>
          `hand ${h.handId}: ${h.gripping ? 'GRIP' : 'open'}  pinch ${h.pinchRatio?.toFixed(2) ?? '–'}  fist ${h.fistRatio?.toFixed(2) ?? '–'}`,
      ),
      '[ ] pinch   - = fist   R record   D hide',
    ]
    this.el.textContent = lines.join('\n')
  }

  private onKey(key: string): void {
    const c = this.config
    const clamp = (v: number) => Math.round(Math.max(0.05, v) * 100) / 100
    switch (key.toLowerCase()) {
      case 'd':
        this.visible = !this.visible
        break
      case '[':
        c.pinchThreshold = clamp(c.pinchThreshold - 0.02)
        break
      case ']':
        c.pinchThreshold = clamp(c.pinchThreshold + 0.02)
        break
      case '-':
        c.fistThreshold = clamp(c.fistThreshold - 0.05)
        break
      case '=':
        c.fistThreshold = clamp(c.fistThreshold + 0.05)
        break
      case 'r':
        this.toggleRecording()
        break
    }
  }

  private toggleRecording(): void {
    if (!this.recording) {
      this.recording = []
      return
    }
    const blob = new Blob([JSON.stringify(this.recording)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `landmarks-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    this.recording = null
  }
}
```

- [ ] **Step 2: Replace `src/main.ts`**

```ts
import './style.css'
import { gripConfig } from './config'
import { PER_SHELF, SITES } from './data/sites'
import { DebugPanel } from './debug/DebugPanel'
import { PlaceholderFuseClient } from './fuse/FuseClient'
import { GestureEngine } from './gesture/GestureEngine'
import { MouseHand } from './input/MouseHand'
import { Renderer } from './render/Renderer'
import { Scene } from './scene/Scene'
import { HandTracker } from './tracking/HandTracker'
import type { InputFrame, TrackedHand } from './types'

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!
const video = document.querySelector<HTMLVideoElement>('#camera')!
const banner = document.querySelector<HTMLElement>('#banner')!
const hint = document.querySelector<HTMLElement>('#hint')!

const fuseClient = new PlaceholderFuseClient()
const scene = new Scene({
  sites: SITES,
  perShelf: PER_SHELF,
  width: innerWidth,
  height: innerHeight,
  onFuse: (a, b) => {
    fuseClient.fuse(a, b).then(
      (result) => scene.setFuseResult(result),
      (err) => {
        console.error('fuse failed', err)
        scene.setFuseError(a.id, b.id)
      },
    )
  },
})
const renderer = new Renderer(canvas, SITES)
const engine = new GestureEngine(gripConfig)
const mouse = new MouseHand(canvas)
const debug = new DebugPanel(document.querySelector<HTMLElement>('#debug')!, gripConfig)

function resize() {
  renderer.resize(innerWidth, innerHeight)
  scene.resize(innerWidth, innerHeight)
}
addEventListener('resize', resize)
resize()

let tracker: HandTracker | null = null
let lastHandSeen = performance.now()

async function startCamera() {
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: 'user' },
      audio: false,
    })
    await video.play()
    tracker = await HandTracker.create()
  } catch (err) {
    console.error('camera/tracker unavailable', err)
    banner.textContent = 'Camera unavailable — using mouse mode (drag logos with the mouse).'
    banner.hidden = false
  }
}

function frame(now: number) {
  const hands: TrackedHand[] = tracker ? tracker.detect(video, now, innerWidth, innerHeight) : []
  const fromHands = engine.update(hands)
  const fromMouse = mouse.poll()
  const input: InputFrame = {
    cursors: [...fromHands.cursors, ...fromMouse.cursors],
    events: [...fromHands.events, ...fromMouse.events],
  }
  scene.update(now, input)
  debug.record(hands)
  debug.update(input.cursors)
  renderer.showDebug = debug.visible
  renderer.draw(scene, tracker ? video : null, hands)

  if (hands.length) lastHandSeen = now
  hint.hidden = !tracker || now - lastHandSeen < 3000
  requestAnimationFrame(frame)
}

void startCamera()
requestAnimationFrame(frame)
```

- [ ] **Step 3: Verify build**

Run: `npm run typecheck && npm test && npm run build`
Expected: all exit 0.

- [ ] **Step 4: Live check (manual, with the webcam)**

Run: `npm run dev`, open http://localhost:5173 in Chrome, allow the camera. Check each:

1. Mirrored, dimmed camera feed; 6 logos down each edge; Spotify and Airbnb in the center slots.
2. Moving an open hand shows a ring cursor; it glows logos it passes over.
3. Pinch on a center logo → it lifts, follows the hand, slot shows a dashed ring. Open hand → it flies back.
4. Fist works the same as pinch.
5. Pinch a shelf logo, drop it on a center slot → it replaces that slot; the old one flies to its shelf.
6. One logo in each hand, bring hands together → burst, spinning card, then "Spotify × Airbnb"-style label after ~1.2 s.
7. Grip the card, pull to the left or right edge, release → card disappears, slots are back.
8. Press `D` → panel shows live pinch/fist ratios and landmark dots; `[`/`]` change the pinch threshold.
9. Hide both hands for 3 s → hint pill appears; show them → it hides.
10. Reload and deny the camera → red banner; dragging with the mouse does steps 3, 5, and one-hand fuse (drag left center logo onto the right one).

If grips feel too eager or too sticky, tune with the debug keys, then copy the values into `src/config.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/debug
git commit -m "feat: wire camera, gestures, scene and renderer with debug panel"
```

---

### Task 16: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# fuse-web

Grab two website logos with your hands and fuse them into something new.

Your webcam tracks both hands in the browser (MediaPipe). Logos sit on shelves along the
screen edges; two are active in the middle. Pinch or make a fist to grab. Hold one logo in
each hand and bring them together to fuse.

> Phase 1: gesture UI with a placeholder fuse result. AI logo fusion and fused landing
> pages come next — see `docs/superpowers/specs/`.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173 and allow camera access. Everything runs locally in the
browser; no API keys are needed for Phase 1.

## Controls

| Gesture | Does |
|---|---|
| Pinch or fist on a logo | Grab it |
| Drop a shelf logo on a center slot | Swap it in |
| One logo per hand, bring hands together | Fuse |
| Drag one center logo onto the other | Fuse (one hand / mouse) |
| Pull the result card to a screen edge | Dismiss |

Mouse works as a single hand. Press `D` for the debug panel (`[` `]` pinch threshold,
`-` `=` fist threshold, `R` record landmarks to JSON).

## Develop

```bash
npm test         # unit tests (gesture engine, scene rules, tracking math)
npm run build    # typecheck + production build
```

Logos from [Simple Icons](https://simpleicons.org) (CC0). Brand names and logos belong to
their owners and are used here only for a non-commercial demo.

## License

MIT
````

- [ ] **Step 2: Pre-push safety check (do not push)**

Run:
```bash
git add README.md
git grep -n -I -E 'AIza|sk-[A-Za-z0-9]|api[_-]?key\s*[:=]|-----BEGIN|@hotmail|@gmail|/Users/' -- . ':!package-lock.json' || echo "clean"
```
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: README for Phase 1"
```

Stop here. Report to the owner; they review and push.
