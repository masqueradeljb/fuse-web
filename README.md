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

`npm install` also copies MediaPipe's wasm runtime and downloads the hand-landmark model
(~7.5 MB) into `public/` (both git-ignored), so the app works offline afterwards.

Open http://localhost:5173 and allow camera access. Everything runs locally in the
browser; no API keys are needed for Phase 1.

If the camera prompt doesn't appear on macOS, allow your browser under System Settings →
Privacy & Security → Camera, then reload.

## Controls

| Gesture | Does |
|---|---|
| Pinch or fist on a logo | Grab it |
| Drop a shelf logo on a center slot | Swap it in |
| One logo per hand, bring hands together | Fuse |
| Drag one center logo onto the other | Fuse (one hand / mouse) |
| Pull the result card to the left or right edge | Dismiss |

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
