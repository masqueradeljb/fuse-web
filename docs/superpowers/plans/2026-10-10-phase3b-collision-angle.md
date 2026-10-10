# Phase 3b — Collision Fuse + Angle Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** (1) Two-hand fusing requires pushing the logos into each other until a charge fills; (2) the fused page borrows the reference site's marketing angle and hero format, with a generated on-angle hero image and the reference hero video when available.

**Spec:** `docs/superpowers/specs/2026-10-10-fuse-web-design.md` → "Phase 3b refinements".

**Testing:** lightweight — only the tests listed. Visuals are checked live.

**Rules:** keys only from server env; never print/log/write them; Gemini key only in the `x-goog-api-key` header; no real API calls (the controller does one live run). Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push. Never kill processes you didn't start (own dev server: `npx vite --port 5299 --strictPort`, stop by PID).

---

### Task A: Collision fuse (Scene + Renderer)

**Files:** `src/config.ts`, `src/scene/Scene.ts`, `src/scene/Scene.test.ts`, `src/render/Renderer.ts`

- [ ] **Step 1: Config** — in `sceneConfig` replace `fuseDistanceFactor` with:
```ts
  /** push depth (0–1 past contact) below which a collision doesn't charge */
  chargeMinPush: 0.08,
  /** charge per second at the minimum push… */
  chargeBase: 0.8,
  /** …plus this × push depth */
  chargeGain: 2.2,
  /** charge lost per second when not pushing */
  chargeDecay: 1.5,
```

- [ ] **Step 2: Tests first** — in `Scene.test.ts` replace the two-hand fuse tests ("…fuse when brought together", "…far apart do not fuse", the 4:3 one if it relies on proximity) with:
```ts
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
```
(Keep the one-hand drop fuse tests unchanged. Any other test that fused via proximity should now push for several steps, e.g. loop like "pushing hard".)

- [ ] **Step 3: Scene** — replace `checkTwoHandFuse` with a collision step and expose state:
```ts
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
```
Add `collision: Collision | null = null` to `Scene`. In `update`, after the follow loop, call `this.collide(dt)`:
```ts
  private collide(dt: number): void {
    const holds = this.fuse ? [] : [...this.held.values()].filter((h) => h.from.kind === 'slot')
    if (holds.length !== 2) {
      this.collision = null
      return
    }
    const [a, b] = holds
    const c = this.config
    const contact = 2 * this.layout.slotRadius * c.heldScale
    const dx = b.target.x - a.target.x
    const dy = b.target.y - a.target.y
    const d = Math.hypot(dx, dy) || 1e-6
    const axis = { x: dx / d, y: dy / d }
    const prev = this.collision?.charge ?? 0
    // logos can't overlap: if their current positions are closer than contact, push them apart around their midpoint
    const pd = dist(a.pos, b.pos)
    if (pd < contact) {
      const mid = lerp(a.pos, b.pos, 0.5)
      const ux = pd > 1e-6 ? (b.pos.x - a.pos.x) / pd : axis.x
      const uy = pd > 1e-6 ? (b.pos.y - a.pos.y) / pd : axis.y
      a.pos = { x: mid.x - (ux * contact) / 2, y: mid.y - (uy * contact) / 2 }
      b.pos = { x: mid.x + (ux * contact) / 2, y: mid.y + (uy * contact) / 2 }
    }
    const push = Math.min(Math.max((contact - d) / contact, 0), 1)
    if (push <= 0 && prev <= 0) {
      this.collision = null
      return
    }
    const charge =
      push > c.chargeMinPush ? prev + dt * (c.chargeBase + c.chargeGain * push) : Math.max(0, prev - dt * c.chargeDecay)
    this.collision = { point: lerp(a.pos, b.pos, 0.5), axis, push, charge: Math.min(charge, 1) }
    if (charge >= 1) {
      const at = this.collision.point
      this.collision = null
      this.startFuse(at)
    }
  }
```
Keep a decaying collision object while charge > 0 even when the logos separate (so the ring drains visibly); set `collision = null` once both push and charge are 0. Remove `fuseDistanceFactor` uses.

- [ ] **Step 4: Renderer** — when `scene.collision` is set (visual only, honor reduced motion = ring only):
  - **Squash:** when drawing each held slot logo, apply a transform rotated to `axis`: scale `1 − 0.18·push` along the axis, `1 + 0.08·push` across.
  - **Jitter:** offset each held logo by random ±`4·charge` px per frame.
  - **Sparks at the seam:** emit `round(push·6)` short-lived sparks per frame from `point`, flying roughly perpendicular to `axis`, in both brand colors (cap total ~80, reuse the particle pool style from the fuse effect).
  - **Charge ring:** an arc around `point` of radius `0.5·slotRadius`, sweep `2π·charge`, stroke gradient A→B, thicker as charge grows; a faint full ring behind it.
  - **Screen shake:** when `charge > 0.8`, translate the whole frame by random ±`6·(charge−0.8)/0.2` px.
  - **Hint:** while colliding and `charge < 0.3`, draw small text under the point: "push harder!".

- [ ] **Step 5: Verify & commit** — `npx vitest run src/scene && npm run typecheck && npm run build`.
```bash
git add src/config.ts src/scene src/render
git commit -m "feat: collision fuse — push logos together until the charge fills"
```

---

### Task B: Richer capture, angle prompt, generated hero + reference video

**Files:** `server/site/types.ts`, `server/site/inspectPage.ts`, `server/site/capture.test.ts`, `server/site/prompt.ts`, `server/site/hero.ts` (new), `server/site/jobs.ts`, `server/site/handler.ts`, `server/logo/handler.ts` (export `guardedFetch` + `readCapped`), `server/vite-plugin-site.ts`, `README.md`

- [ ] **Step 1: Types** — extend `SiteCapture`:
```ts
export interface SiteHero {
  eyebrow: string
  headline: string
  subhead: string
  cta: string
  media: 'video' | 'image' | 'background' | 'none'
  /** absolute http(s) URL of the hero video/image/background (never blob:) */
  src?: string
  /** video poster, if any */
  poster?: string
}
// SiteCapture gains:
  hero: SiteHero
  description: string   // meta description
  ogImage?: string
```
Sections: up to 8, text up to 300 chars; images up to 10.

- [ ] **Step 2: `INSPECT_PAGE_JS`** — add hero extraction (plain JS, same style):
  - Hero container = nearest ancestor of the h1 (walk up ≤ 6 levels) whose height ≥ 300 px, else the h1's parent.
  - `eyebrow` = short (≤ 60 chars) visible text element before the h1 inside the container; `subhead` / `cta` from inside the container (same rules as the global ones).
  - `media`: first visible `<video>` in the container (or one whose rect overlaps the container) → `src` = `currentSrc` or first `<source src>` (skip `blob:`/`data:`), `poster` = `poster` attr (absolute). Else largest `<img>` in the container → `image`. Else computed `background-image: url(...)` on the container or its first 3 ancestors → `background`. Else `none`.
  - `description` = `meta[name=description]` content; `ogImage` = `meta[property="og:image"]` content (absolute).
- [ ] **Test:** extend the existing capture fixture test with a hero `<video poster="/p.jpg"><source src="/v.mp4"></video>` inside the h1's section, plus `<meta name="description">`: assert `hero.media === 'video'`, `hero.src` ends with `/v.mp4`, `hero.poster` ends with `/p.jpg`, `description` matches. (One test, extended — no new test file.)

- [ ] **Step 3: Prompt (`server/site/prompt.ts`)** — rewrite roles and add angle + hero rules. `PagePromptInput` gains `heroImageUrl: string` and the style site's `hero` (from its capture). Key instructions (keep the existing output rules: one HTML doc, `<style>` only, no scripts, responsive, accessible):
  - "LEFT / PRODUCT = {A}: what the product is, who it's for, its real facts and features, its logo."
  - "RIGHT / REFERENCE = {B}: visual style (tokens, typography, buttons, radii, spacing), page structure and section rhythm, hero format, and its marketing angle."
  - "First, silently identify (1) {B}'s positioning angle in one sentence — the promise it makes to its audience (e.g. 'economic opportunity for drivers'); (2) {A}'s product and audience. Then write the page for {A}'s audience using {B}'s angle (e.g. 'economic opportunity for builders'). Mirror {B}'s hero layout and section order."
  - Hero: "Use `<img src="{heroImageUrl}">` as the main hero visual." If the style hero has `media === 'video'` with `src`: "Also place `<video autoplay muted loop playsinline poster="{poster}" src="{src}">` as a full-bleed background behind the hero with a dark tint overlay so text stays readable." Otherwise no video.
  - Images: product images from {A}'s list for feature sections; never use {B}'s images except the hero video above.
  - Include the style capture's `hero`, `description` and section headings (for structure/angle), and the content capture's `content`, `hero`, `description`, `images`.

- [ ] **Step 4: Hero image (`server/site/hero.ts`)**
```ts
// generateHero(options, input, signal) → Buffer (PNG)
// input: { productName, productSummary, audienceHint?, styleName, reference: Buffer /* png or jpeg */ , referenceType: 'image/png' | 'image/jpeg' }
```
  - Calls OpenAI `POST /v1/images/edits` (same pattern as `server/fuse/handler.ts`: `FormData`, `image[]` = the reference, `model` = `options.model`, `quality` = `options.quality`, `size` = `'1536x1024'`), prompt:
    "This image is the hero visual from {styleName}'s landing page. Create a new hero image with the same composition, framing, lighting, color grading and mood, but about {productName}: {productSummary}. Show its audience in the same role the reference shows its audience. Photographic if the reference is photographic, illustrated if illustrated. No text, no letters, no logos, no UI."
  - 401/403 → generic error; other errors redacted (`sk-…`); returns the decoded PNG.
  - Reference image choice (in jobs): style hero `poster` → hero `src` if `media` is `image`/`background` → `ogImage` → the style screenshot (JPEG). Download remote ones with the exported `guardedFetch` + `readCapped` from `server/logo/handler.ts` (image/*, ≤ 4 MB); fall back to the screenshot on any failure.
  - `productSummary` = content `description` or hero subhead or headline (≤ 200 chars).

- [ ] **Step 5: Jobs + routes**
  - In `run`: after captures, run page generation and hero generation **in parallel** (`Promise.allSettled`). Page failure → job error. Hero failure → `console.warn`, remember a fallback URL (style hero src/poster/ogImage) for the hero route. Save the hero as `cache/pages/<id>-hero.png`. The prompt gets `heroImageUrl: /api/fuse-site/hero?id=<id>`.
  - Hero generation needs `options.apiKey` (OpenAI); if missing, skip it (fallback URL only).
  - `GET /hero?id=` → the PNG if present; else 302 to the fallback URL if known; else 404.
  - Page CSP: add `media-src https:`.
- [ ] **Test:** none new beyond Step 2 (hero/jobs are covered by the live run).

- [ ] **Step 6: README** — one paragraph on angle transfer and the generated hero (+ reference video), with the extra ~$0.03 per fused page.

- [ ] **Step 7: Verify & commit** — `npm run typecheck && npx vitest run && npm run build`; bundle check `grep -rl "OPENAI_API_KEY\|GEMINI_API_KEY\|sk-\|AIza" dist/ || echo "no key refs in bundle"`. Delete stale `cache/sites/*.json` locally (captures changed shape) — it's git-ignored.
```bash
git add server README.md
git commit -m "feat: angle transfer, richer hero capture, generated hero image + reference video"
```

---

### Task C: Live run (controller)

- [ ] Own dev server on 5299; fuse a builder-ish site (left) with Uber (right, has a hero video) via `POST /api/fuse-site`; time it; screenshot the page; check the angle line, the generated hero and the video background. Stop the server by PID.
