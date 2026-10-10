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
| 3 | Use both sites' colors/fonts/copy/hero image → generate a fused landing page with the fused logo | Browser + Node server |

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
  /api/site?url=        SiteInspector  (Playwright + one small inspectPage())
  /api/fuse-logo        LogoFuser      (Gemini image model)
  /api/fuse-site        SiteFuser      (simple token mix + LLM page generation)
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

## Phase 1.5 — your site vs. reference sites

Added after the first live test (2026-10-10).

### Flow

1. **Start page:** one input ("yoursite.com"). On submit the dev server fetches the site's
   logo (below); the stage opens with that logo in the **left slot**. The camera starts here,
   not on page load.
2. **Stage:**
   - **Left shelf = your sites**, newest first, up to 6. A small `+ site` box (top-left)
     adds another; the newest goes into the left slot. Re-adding an existing site moves it
     to the front.
   - **Right shelf = the 12 reference sites**, in 2 columns × 6 rows. The right slot starts
     with the first one.
   - Left-shelf logos only drop into the left slot; right-shelf logos only into the right
     slot. A fuse is always *your site × a reference site*.
3. **Result card zones** (replace left/right-edge dismissal, which clashed with the shelves):
   - While the card is held, entering the **bottom 15%** of the screen dismisses it at once
     (no release needed — hands often leave the camera view at the edges).
   - Entering the **top 15%** with a finished card opens the fused page and releases the card,
     which glides back to the center.
   - Zone hints ("↑ open fused site", "↓ dismiss") show while the card is held.
4. **Fused page:** `fused.html?pair=<a>__<b>` — a placeholder (split brand colors, both
   logos, "A × B", "coming in Phase 3"). Pair data is handed over via `localStorage`.
   Opened with `window.open`; a hand gesture isn't a user activation, so Chrome may block
   it — then the same page shows in a full-screen in-app overlay (close with × or Esc) and a
   banner suggests allowing pop-ups for the site.

### Logo fetching — `/api/logo?url=` (Vite dev-server middleware)

Lightweight on purpose; no headless browser.

- Normalize input (`yoursite.com` → `https://yoursite.com`); only http(s); refuse
  loopback/private/link-local hosts (a rough guard — this is a local demo, not a hosted
  service).
- Fetch the page HTML (6 s timeout, browser-like UA), parse `<link>`/`<meta>` in `<head>`.
- Candidates, best first: apple-touch-icon (largest) → SVG icon → largest sized icon →
  other icons → Google's favicon service (`s2/favicons?sz=256`). Mask icons are skipped.
- Fetch candidates in order; the first `image/*` response under 2 MB wins. Cached in memory
  and served same-origin at `/api/logo/img?id=<site id>`, so the browser can read its pixels.
- Name: `og:site_name` → first segment of `<title>` → hostname.
- Response: `{ id, name, url, logoUrl }`. The browser samples the logo's dominant color
  (saturation-weighted average of opaque pixels) for the card's half.
- User logos render as the full-color image on a white circle; reference logos keep the
  simple-icons glyph on brand color.

Phase 2 reuses this route for the logo; the heavier Playwright inspection below is only
needed for Phase 3's style capture.

## Site inspection (shared by Phases 2 and 3)

One endpoint, one small function — deliberately light. If a site can't be fully read, we
use what we got; the demo never blocks on a perfect capture.

### `/api/site?url=`

Playwright opens the landing page (headless Chromium, 1440×900, `domcontentloaded` + 2 s
settle, 10 s timeout), runs **one** `inspectPage()` function via `page.evaluate()`, and
takes one viewport screenshot. Result cached at `cache/sites/<domain>.json` + `.jpg`.

`inspectPage()` lives in `server/capture/inspectPage.ts`, ~100 lines, written fresh for this
repo. It samples a handful of elements, not the whole DOM:

| Field | How |
|---|---|
| `logo` | first of: inline `<svg>` inside `header`/`nav` or a link to `/` (serialized) → `<img>` there whose src/alt/class mentions "logo" → `link[rel=apple-touch-icon]` → `meta[property=og:image]` |
| `favicon` | best `link[rel~=icon]`, else `/favicon.ico` |
| `colors` | computed `background-color` of `body`; `color` of `body` and `h1`; background of the first visible button/CTA link (`accent`) |
| `fonts` | computed `font-family` of `h1` and `body` |
| `radius` | `border-radius` of that same CTA |
| `copy` | `<title>`, first `h1`, first `p` after it, CTA text |
| `heroImage` | largest visible `<img>` in the first viewport |

Earlier landing-capture code by the same author was used as a reference for these
heuristics only; none of it is copied, and the heavier parts (full token profile,
component recipes, full-page CDP screenshots, link maps, footers) are intentionally left
out.

## Phase 2 — real logos + AI fusion

### Logo

From `/api/site`: `logo` → `favicon` → `https://www.google.com/s2/favicons?domain=…&sz=256`.
Normalized to a 512×512 PNG (`sharp`, transparent padding; SVGs rasterized by `sharp`),
cached at `cache/logos/<domain>.png`.

The site library gains real logos: Phase 1's `iconSlug` stays as the instant fallback
while the fetched logo loads. A text box ("+ site URL") adds a site to a shelf.

### Logo fusion — `/api/fuse-logo`

Input: two site ids. Sends both PNGs to Gemini `gemini-3.1-flash-image-preview`
("Nano Banana 2") via `@google/genai` with a fixed prompt: merge the two marks into **one
new logo** that keeps a recognizable element of each, flat vector style, centered, plain
background, no text unless both originals are wordmarks. 1:1, 1K.

Auth: `GEMINI_API_KEY`, or Vertex via `GOOGLE_GENAI_USE_VERTEXAI=True` +
`GOOGLE_CLOUD_PROJECT` (see Secrets). Result is cached at
`cache/fused/<a>__<b>.png` (pair sorted, so A×B = B×A). 30 s timeout.

While generating (~5–15 s), the Phase 1 placeholder card shows with a "fusing…" shimmer;
the real logo cross-fades in.

## Phase 3 — fused landing page

### `/api/fuse-site`

Uses the two cached `/api/site` results — no extra capture.

1. **Mix (code, a few lines):** background + text color + heading font from A; accent
   color + body font + radius from B. Which site is A is decided by a hash of the pair id,
   so it's stable per pair.
2. **Generate (LLM):** Claude (`claude-sonnet-5-5`) gets the mixed tokens as CSS custom
   properties, both sites' copy, both hero image URLs, both screenshots (as images, for
   vibe), and the fused logo path. It returns one self-contained HTML file: nav with
   fused logo, hero, 3-feature section, CTA band, footer. Fused name and copy are invented
   ("Spotbnb — stay where the music is").
3. Saved to `cache/pages/<a>__<b>.html`, served at `/fused/<a>__<b>`.

In the app, the result card gains an "Open fused site" target; pull it to the center (or
click) to show the page in a full-screen iframe.

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
