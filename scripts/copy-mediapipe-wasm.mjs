// Copies MediaPipe's wasm runtime into public/ so the app can load it locally.
import { cpSync, existsSync, mkdirSync } from 'node:fs'

const src = 'node_modules/@mediapipe/tasks-vision/wasm'
if (existsSync(src)) {
  mkdirSync('public', { recursive: true })
  cpSync(src, 'public/mediapipe-wasm', { recursive: true })
}
