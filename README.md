# The Fused Web

A small, playful browser demo: hold your website's logo in one hand and a famous brand's logo in
the other, push them together in front of your webcam, and get back a **fused logo** and a
**fused landing page**, your product told in the other brand's style.

Built for fun at a builder event. It's a toy, not a product.

## How it plays

1. **Paste your URL.** The app fetches your site's logo.
2. **Grab.** Your webcam tracks both hands in the browser. Your logo sits on the left, a dozen
   well-known brands on the right. Pinch or make a fist to pick a logo up.
3. **Fuse.** Hold one logo in each hand and press them together until the charge ring fills.
4. **Watch it build.** An image model draws one logo that fuses the two. In the background a
   language model writes a landing page: the left site's product, in the right site's look and
   marketing angle.
5. **Open or dismiss.** Pull the result card up to open the fused page, or down to throw it away.

No camera? The mouse works as one hand: drag one center logo onto the other to fuse.

## How it works

| Piece | What it does |
|---|---|
| Hand tracking | [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) runs fully in the browser; video never leaves your machine |
| Gestures | Pinch / fist detection with smoothing and hysteresis, turned into grab, drag and release |
| Stage | Plain Canvas 2D: shelves, slots, light effects, the collision charge, the fuse burst |
| Logo fetch | The dev server reads a site's HTML and picks its best icon (with SSRF guards) |
| Logo fusion | OpenAI image editing: left logo = subject, right logo = style |
| Page fusion | Playwright captures both sites (colors, type, copy, hero); Gemini writes a single static page from a "fusion brief"; a hero image is generated in parallel. Pages are served with scripts blocked |

Everything runs from one Vite dev server. API keys are read on the server only and are never
sent to the browser.

## Run it

Requirements: Node 20+, a webcam (optional), and your own API keys for the AI parts.

```bash
npm install                      # also fetches the MediaPipe runtime + hand model into public/
npx playwright install chromium  # one time, for capturing sites
cp .env.example .env             # then add your keys
npm run dev
```

Open http://localhost:5173 and allow camera access.

| Key | Used for | Without it |
|---|---|---|
| `OPENAI_API_KEY` | fused logo, fused-page hero image | a placeholder logo |
| `GEMINI_API_KEY` | fused landing page | no fused page |

Costs are small (a few cents per fusion) and printed in the server console.
`FUSE_MAX_GENERATIONS` and `FUSE_MAX_PAGES` cap how many paid calls one server run can make.
Results are cached in `cache/`, so fusing the same pair again is free and instant.

If the camera prompt doesn't appear on macOS, allow your browser under System Settings →
Privacy & Security → Camera, then reload.

## Controls

| Gesture | Does |
|---|---|
| Pinch or fist on a logo | Grab it |
| Drop a shelf logo on a center slot | Swap it in |
| One logo per hand, press together | Fuse |
| Drag one center logo onto the other | Fuse (one hand / mouse) |
| Pull the result card up / down | Open the fused page / dismiss |

Press `D` for a debug panel with the grip thresholds.

## Develop

```bash
npm test         # unit tests (gestures, scene rules, tracking math, server handlers)
npm run build    # typecheck + production build
```

The site-fetching endpoints exist only in `npm run dev` / `npm run preview`; they fetch public
pages from your own machine.

## Credits

Brand glyphs from [Simple Icons](https://simpleicons.org) (CC0). Fonts: DM Serif Display, DM Sans
and JetBrains Mono (OFL), bundled via Fontsource. Brand names and logos belong to their owners
and are used here only in a non-commercial demo; fused results are parodies, not real brand work.

## License

MIT
