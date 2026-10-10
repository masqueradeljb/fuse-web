# THE Fused Web

Grab two website logos with your hands and fuse them into something new.

Enter your site on the start page and its logo is fetched for you. Your webcam tracks both
hands in the browser (MediaPipe): your logo sits on the left, 12 reference sites on the
right. Pinch or make a fist to grab, hold one logo in each hand and smash them together to
fuse. The dev server asks OpenAI for one new logo that fuses the two (see "Fusion
(OpenAI)" below). Pull the result card up to open its fused page, or down to dismiss it.

## Run

```bash
npm install
npm run dev
```

`npm install` also copies MediaPipe's wasm runtime and downloads the hand-landmark model
(~7.5 MB) into `public/` (both git-ignored), so the app works offline afterwards.

Open http://localhost:5173, enter your site on the start page, and allow camera access. Everything runs locally in the
browser; without an OpenAI key the fuse falls back to a placeholder.

Site fusion needs Chromium for Playwright: `npx playwright install chromium` (one time).

If the camera prompt doesn't appear on macOS, allow your browser under System Settings →
Privacy & Security → Camera, then reload.

## Your site vs. reference sites

- On the start page, enter your site. Its logo is fetched by the dev server (`/api/logo`)
  and appears on the left. `+ add your site` (top-left) adds more.
- The right side holds 12 reference sites. Any logo can go in either center slot, so you
  can fuse your site with a reference site or two of your own sites.
- Result card: pull it **up** to open the fused page (a new tab; if pop-ups are blocked it
  opens in-app, so allow pop-ups for the site to get tabs), pull it **down** to dismiss.
- `/api/logo` fetches public pages from your machine; it only runs in `npm run dev` /
  `npm run preview`.

## Fusion (OpenAI)

- Set `OPENAI_API_KEY` in your shell, or copy `.env.example` to `.env` (git-ignored) and
  fill it in. The key is only read by the dev server (`/api/fuse-logo`); it is never sent
  to the browser.
- The **left** slot gives the subject, the **right** slot gives the style.
- A fusion takes ~10–30 s. Results are cached in `cache/fused/`, so the same pair again is
  instant and free.
- The dev-server console prints the cost of each generation. `FUSE_MAX_GENERATIONS`
  caps generations per server run (default 50).
- Without a key you get the placeholder fuse (a banner says so).

## Fused site

When a fuse starts, the dev server also builds a fused landing page in the background: the left
site's content in the right site's style. Pulling the card up opens `fused.html`, which shows a
"building…" view and switches to the page when it is ready.

- One-time Chromium install for the capturer: `npx playwright install chromium`.
- Angle transfer: the left site is the product, the right site is the reference. Gemini is
  asked to identify the reference's marketing angle (e.g. "economic opportunity for drivers")
  and rewrite the page for the product's audience in the reference's hero layout. In parallel
  an on-angle hero image is generated from the reference's hero visual (OpenAI image edits,
  about $0.03 extra per fused page, served at `/api/fuse-site/hero?id=…`; falls back to the
  reference's own hero image if generation fails). If the reference hero has a video, it is
  embedded as the hero background.
- Captures are cached in `cache/sites`, generated pages in `cache/pages`.
- `GEMINI_API_KEY` (page) is separate from `OPENAI_API_KEY` (logo). Tunables: `FUSE_PAGE_MODEL`,
  `FUSE_PAGE_THINKING`, `FUSE_MAX_PAGES`.
- Pages are served with scripts blocked.

## Controls

| Gesture | Does |
|---|---|
| Pinch or fist on a logo | Grab it |
| Drop a shelf logo on a center slot | Swap it in |
| One logo per hand, bring hands together | Fuse |
| Drag one center logo onto the other | Fuse (one hand / mouse) |
| Pull the result card up | Open the fused page |
| Pull the result card down | Dismiss |

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
