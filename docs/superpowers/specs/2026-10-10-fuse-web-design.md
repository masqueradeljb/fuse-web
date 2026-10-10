# fuse-web — Design

**Date:** 2026-10-10
**Repo:** github.com/masqueradeljb/fuse-web (MIT)
**Status:** Design approved in brainstorming; awaiting spec review

## What it is

A demo web app: your Mac webcam watches your hands. Website logos sit on shelves at the
screen edges; two are "active" in the middle. Grab one logo in each hand, bring your hands
together, and the two sites **fuse** — first into a new logo, then into a new landing page
that mixes both sites' style.

Demo quality. "Cool" beats "correct": the fused page does not need to take the objectively
best parts of each site.

## Phases

Built and shipped in order; each phase is usable on its own.

| Phase | Delivers | Runs where |
|---|---|---|
| 1 | Two-hand gesture UI: grip, pull from shelf, bring together → fuse event (placeholder result) | Browser only |
| 2 | Real logos fetched from landing pages + AI-fused logo (Nano Banana) | Browser + Node server |
| 3 | Capture both sites' design tokens/assets/copy → generate a fused landing page with the fused logo | Browser + Node server |

The seam between phases is one event: `onFuse({ siteA, siteB })`. Phase 1 emits it; phases 2
and 3 consume it. The UI never changes shape when the backends arrive.

## Architecture

```
Browser (Vite + TypeScript, no framework)
  Webcam ─► HandTracker ─► GestureEngine ─► Scene ─► Renderer (canvas)
                                              │
                                              └─► FuseClient ──HTTP──┐
                                                                     │
Node server (TypeScript, Hono)                                       ▼
  /api/logo?url=        LogoResolver   (Playwright + ported collectors)
  /api/fuse-logo        LogoFuser      (Gemini image model)
  /api/capture?url=     SiteCapture    (Playwright + ported collectors)
  /api/fuse-site        SiteFuser      (token mixing + LLM page generation)
  /fused/:id            serves generated pages
  cache/                logos, captures, fused results on disk
```

One repo, one `package.json`. `src/` is the browser app, `server/` is the Node server. Vite
proxies `/api` and `/fused` to the server in dev. Phase 1 has no server.

### Browser units

Each unit has one job and can be tested without the ones around it.

- **`tracking/HandTracker`** — Wraps MediaPipe `HandLandmarker` (`@mediapipe/tasks-vision`,
  GPU delegate, `numHands: 2`, VIDEO mode). Output per frame: up to two hands, each with
  21 landmarks in mirrored screen coordinates, smoothed with a One Euro filter. Keeps a
  stable hand id across frames by nearest-match to the previous frame (MediaPipe's
  left/right label alone flips too often).
- **`gesture/GestureEngine`** — Pure function of tracked hands over time → events:
  `gripStart / gripMove / gripEnd` (per hand id, with a cursor point). No DOM, no camera.
- **`scene/Scene`** — All app state: site library, two shelves, two center slots, what each
  hand holds, fuse status. Consumes gesture events, emits `onFuse`. Knows nothing about
  pixels or the camera beyond screen coordinates.
- **`render/Renderer`** — Draws mirrored video, shelves, slots, held logos, hover glow,
  hand cursors, and the fuse animation. Reads Scene; never mutates it.
- **`input/MouseHand`** — Dev/fallback input: the mouse acts as one hand (press = grip).
  Produces the same events as GestureEngine, so Scene can't tell the difference.
- **`fuse/FuseClient`** — Phase 1: returns a placeholder after a short delay. Phases 2–3:
  calls the server.
- **`data/sites.ts`** — The site library: `{ id, name, url, iconSlug }`. Phase 1 ships ~12
  hand-picked sites using `simple-icons` SVGs (e.g. Spotify, Airbnb, Stripe, Netflix,
  GitHub, Notion, Duolingo, Figma, Discord, Slack, Uber, Apple).

## Phase 1 — gesture interaction

### Grip detection

A hand is **gripping** if either holds:

- **Pinch:** distance(thumb tip #4, index tip #8) < 0.30 × hand scale
- **Fist:** mean distance(fingertips #8,#12,#16,#20 → wrist #0) < 0.9 × hand scale

Hand scale = distance(wrist #0, middle MCP #9), so it works at any distance from the camera.

Hysteresis prevents flicker: grip starts below the threshold for 2 consecutive frames and
ends only above 1.3× the threshold for 3 consecutive frames. Thresholds live in one config
object so they can be tuned live (debug panel, toggled with `D`).

**Cursor point:** pinch → midpoint of thumb and index tips; fist → palm center (mean of
#0, #5, #9, #13, #17).

### Layout

```
 ┌──────────────────────────────────────────────────┐
 │ [▢]                                          [▢] │
 │ [▢]                                          [▢] │
 │ [▢]        ( A )            ( B )            [▢] │
 │ [▢]                                          [▢] │
 │ [▢]                                          [▢] │
 │ [▢]                                          [▢] │
 └──────────────────────────────────────────────────┘
   left shelf    two center slots            right shelf
```

Full-window mirrored video, dimmed ~40%. 6 logos per shelf, 12 total. Center slots start
filled with the first site of each shelf.

### Rules

1. **Hover:** a hand cursor within a logo's radius makes it glow.
2. **Grab:** grip starts while hovering → that hand holds the logo; it follows the cursor
   with slight lag (spring) and scales up 10%.
3. **Pull from shelf:** grabbing a shelf logo lifts a copy. Dropping it on a center slot
   replaces that slot; the replaced logo animates back to its shelf. Dropping anywhere else
   animates it back to the shelf.
4. **Two-hand fuse (primary):** each hand holds a center logo, and the two held logos come
   within 1.2× logo diameter of each other → **fuse**. They snap together, flash, burst.
5. **One-hand fuse (fallback):** drop a held center logo onto the other center slot → fuse.
6. **During a fuse:** input is ignored on the slots. The result card shows in the middle;
   grip on it and pull it to either edge to dismiss and restore the two slots.

### Phase 1 placeholder result

A card with both logos overlapped, a split two-color background from each site's brand
color, and the label "Spotify × Airbnb". Proves the whole loop without any backend.

## Phase 2 — real logos + AI fusion

### Logo fetching — `/api/logo?url=`

Playwright opens the landing page (headless Chromium, 1440×900, wait for network idle,
10 s timeout) and runs the **ported landing-capture collectors** inside it with
`page.evaluate()`: `_collectLogoCandidates` (header/nav/home-link images and inline SVGs
with resolved colors) and `_collectFavicon` (apple-touch-icon preferred).

Pick order: inline header SVG → header `<img>` logo → apple-touch-icon → `og:image` →
`https://www.google.com/s2/favicons?domain=…&sz=256`. The chosen logo is normalized to a
512×512 PNG (`sharp`, transparent padding) and cached at `cache/logos/<domain>.png`.

The site library gains real logos: Phase 1's `iconSlug` stays as the instant fallback
while the fetched logo loads. A text box ("+ site URL") adds a site to a shelf.

### Logo fusion — `/api/fuse-logo`

Input: two site ids. Sends both cached PNGs to Gemini `gemini-3.1-flash-image-preview`
("Nano Banana 2") via `@google/genai` with a fixed prompt: merge the two marks into **one
new logo** that keeps a recognizable element of each, flat vector style, centered, plain
background, no text unless both originals are wordmarks. 1:1, 1K.

Auth: `GEMINI_API_KEY`, or Vertex via `GOOGLE_GENAI_USE_VERTEXAI=True` +
`GOOGLE_CLOUD_PROJECT` (see Secrets). Result is cached at
`cache/fused/<a>__<b>.png` (pair sorted, so A×B = B×A). 30 s timeout.

While generating (~5–15 s), the Phase 1 placeholder card shows with a "fusing…" shimmer;
the real logo cross-fades in.

## Phase 3 — fused landing page

### Capture — `/api/capture?url=`

Same Playwright session pattern as Phase 2. Runs the ported collectors:
`_collectTokenProfile` (colors, font stacks, type scale, spacing, radii, shadows),
`_collectComponentRecipes` (CTA, h1, h2, card, nav, link computed styles),
`_collectAssetUrls` (hero/images, tagged), `_collectPageCopy` (headline, subhead, CTAs),
plus a 1440×900 viewport screenshot. Saved as `cache/captures/<domain>.json` + `.jpg`.

No Chrome extension: the collectors are pure `(doc, win)` functions, so they run unchanged
inside Playwright. An extension is only needed later if we want to capture logged-in pages.

### Fuse — `/api/fuse-site`

1. **Mix (deterministic, code):** build one token set —
   - background + surface colors from A, accent/CTA colors from B
   - heading font + type scale from A, body font from B
   - radii + shadows + button recipe from B, spacing from A
   - The rule is "structure from A, personality from B". A coin flip on the pair id
     decides which site is A, so it's stable for a pair but varied across pairs.
2. **Generate (LLM):** Claude (`claude-sonnet-5-5`) gets the mixed tokens, both sites'
   copy, a few tagged hero assets (by URL), and the fused logo path. It returns one
   self-contained HTML file: nav with fused logo, hero, 3-feature section, CTA band,
   footer. Fused name and copy are invented by the model ("Spotbnb — stay where the music
   is"). CSS uses the mixed tokens as custom properties.
3. Saved to `cache/pages/<a>__<b>.html`, served at `/fused/<a>__<b>`.

In the app, the result card gains an "Open fused site" target; pull it to the center (or
click) to show the page in a full-screen iframe.

## Code reuse

- **Landing-capture collectors** (`server/capture/collectors.js`): ported from the author's
  earlier landing-capture code — pure `(doc, win)` DOM functions for tokens, component
  recipes, assets, logo candidates, favicon and copy, injected via `page.evaluate`. Before
  porting, the author confirms that code may be published here under MIT, and the port
  strips any references to its original product, endpoints or backend.
- **Gemini image calls:** written fresh in TS with `@google/genai`; earlier private scripts
  inform only the model choice and prompt shape.

## Secrets and public-repo hygiene

This repo is public (used at a builder event). Nothing sensitive is committed.

- All keys come from environment variables loaded from `.env` (git-ignored). The repo ships
  `.env.example` with names only: `GEMINI_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI`,
  `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `ANTHROPIC_API_KEY`.
- Keys are used **only in the Node server**. The browser bundle never sees them; Vite only
  exposes `VITE_`-prefixed vars, and no key gets that prefix.
- `cache/` (fetched third-party logos, captures, generated pages) is git-ignored.
- No internal project names, private repo paths, org names, GCP project ids, or personal
  emails in code, docs, or fixtures. Test fixtures are captured from public pages only.
- Before every push: `git diff --cached` review plus a secret scan
  (`gitleaks protect --staged` if installed, otherwise a grep for `AIza`, `sk-`, `key=`,
  `-----BEGIN`).

## Error handling

- **Camera denied / no camera:** banner explains, app runs in MouseHand mode.
- **No hands visible for 3 s:** hint overlay ("Show both hands — pinch or make a fist to
  grab").
- **More than two hands:** track the two largest.
- **Logo fetch fails:** keep the simple-icons fallback, or the google favicon; never block.
- **Fuse call fails or times out:** keep the placeholder card, show "retry" (grip it to
  retry).
- **Capture blocked (bot wall, timeout):** generate from whatever tokens exist plus the
  screenshot; if nothing, fall back to brand color + logo only.
- Server responses are cached on disk; reruns of the same pair are instant.

## Testing

- **GestureEngine:** vitest with recorded landmark fixtures (pinch, fist, open hand,
  borderline jitter) — asserts events and hysteresis. A small recorder (`R` in the debug
  panel) dumps live landmarks to JSON to make fixtures.
- **Scene:** vitest on event sequences — grab, shelf pull + replace, two-hand fuse,
  one-hand fuse, dismiss.
- **Server:** logo pick-order and token mixing tested on saved HTML/capture fixtures;
  Gemini and Claude calls mocked. One manual smoke test per phase against live sites.
- **Manual:** each phase ends with a live webcam run-through of the full loop.

## Out of scope

Mobile/touch, multiple users, accounts, persistence beyond the disk cache, deploying
publicly, capturing logged-in pages, editing the generated page.
