# fuse-web MVP — Handover

**Date:** 2026-10-10
**Status:** Phases 1, 1.5, 2, 3, 3b complete, merged to `main` (tag `v0.3.0`). Not pushed: `v0.2.0` and `v0.3.0` exist only locally; GitHub has `v0.1.0`.
**Next focus:** interface polish — the landing page, the fusing/merging animation, and the waiting screens.

## What exists

A browser demo: paste your site's URL → your logo (left) vs 12 reference sites (right) → grab one logo per hand (webcam, MediaPipe) and push them together until the collision charge fills → AI-fused logo + a fused landing page built in the background.

| Piece | Where | Notes |
|---|---|---|
| Start page "THE Fused Web" + animated backdrop | `index.html` (`#start`), `src/style.css`, `src/ui/startBackdrop.ts` (`startBackdrop(canvas, sites)` → `{ stop }`) | Logo orbs drift/collide/fuse; stops when the stage starts; reduced-motion = still frame |
| Hand tracking → gestures | `src/tracking/*`, `src/gesture/GestureEngine.ts` | Pinch or fist grip; per-camera-frame hysteresis |
| Interaction rules | `src/scene/Scene.ts` | Shelves/slots, collision charge (`collide()`), card zones (↑ open, ↓ dismiss) |
| Canvas drawing | `src/render/Renderer.ts` | `drawCollision` (L264), `drawCardZones` (L380), `drawFuse` (L451) → `drawVortex` (L557, fusing state), `drawResult` (L633), `drawBurst` (L663) |
| "fused!" title | `src/ui/fusedTitle.ts`, `#fused-title` in `index.html`/`style.css` | Hides when the card is gripped |
| Fused page / building view | `fused.html`, `src/fused.ts` (`watchPage`, L23), `src/fused.css` | Polls `/api/fuse-site/status`, then `location.replace` to the page |
| Logo fetch | `server/logo/*` → `/api/logo` | HTML parse → best icon; SSRF/redirect guards |
| AI logo fusion | `server/fuse/*` → `/api/fuse-logo` | OpenAI `gpt-image-2.5-sunburst`, medium, 1024², ~13 s, ~$0.016; left = subject, right = style |
| Site capture | `server/site/capture.ts`, `inspectPage.ts` | Playwright; tokens, content, hero, media, sniffed videos, product snapshots; `CAPTURE_VERSION` |
| Page fusion | `server/site/prompt.ts`, `generate.ts`, `jobs.ts`, `hero.ts` → `/api/fuse-site` | Gemini `gemini-3.8-flash` writes the page from a FUSION BRIEF (left = product, right = style + structure + angle); generated hero image in parallel; ~35–40 s |

Tuning knobs: `src/config.ts` (`chargeMinPush`, `chargeBase`, `chargeGain`, `chargeDecay`, `cardZone`, grip thresholds). Env: `.env.example`.

## Next session: interface polish (owner's list)

1. **Landing page** (`src/ui/startBackdrop.ts`, `#start` styles) — refine look and feel; it's the first thing people see at the builder event.
2. **Fusing / merging animation** — the in-stage collision → burst → fusing sequence (`Renderer.drawCollision`, `drawVortex`, `drawBurst`, `drawResult`); make the merge feel cohesive with the landing backdrop's fusion style.
3. **Waiting screens** — (a) the card's "fusing…" state and status line (`building site…` / `site ready ✓`) in `drawFuse`; (b) the `fused.html` building view (`src/fused.ts`, `src/fused.css`), currently fused logo + gradient bar + stage text.

Suggested approach: screenshot each state with Playwright on your own dev server (`npx vite --port 5299 --strictPort`); the mouse works as a hand for driving the stage without a camera (drag a center logo onto the other for an instant fuse). Keep tests lightweight (owner preference); visuals are checked live.

## Known gaps / ideas

- Uber's hero video isn't captured (likely MSE/`blob:` streaming); pages use the generated hero instead.
- Some product snapshots are sparse first frames of animations (e.g. a near-empty card).
- Generated pages are cached in `cache/pages/` (delete a pair's files to regenerate); site captures in `cache/sites/` auto-refresh when `CAPTURE_VERSION` changes.
- Pushing `v0.2.0`/`v0.3.0` to GitHub awaits the owner's go-ahead.

## Run

```bash
npm install                      # also copies MediaPipe wasm + downloads the hand model
npx playwright install chromium  # one time, for site capture
npm run dev                      # needs OPENAI_API_KEY (logo + hero) and GEMINI_API_KEY (page) in the shell or .env
npm test && npm run build
```

## Resume prompt

```
Resume: fuse-web interface polish

HANDOVER: archive/01_fuse_web_mvp/HANDOVER.md

NEXT TASKS:
1. Polish the landing page (src/ui/startBackdrop.ts, #start in index.html/src/style.css)
2. Polish the fusing/merging animation (Renderer.drawCollision / drawVortex / drawBurst / drawResult)
3. Style the waiting screens: card fusing state (Renderer.drawFuse) and the fused.html building view (src/fused.ts, src/fused.css)
```
