// Prepares runtime assets in public/ on install: MediaPipe wasm (copied) and the hand model (fetched).
import { cpSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

const src = 'node_modules/@mediapipe/tasks-vision/wasm'
if (existsSync(src)) {
  mkdirSync('public', { recursive: true })
  cpSync(src, 'public/mediapipe-wasm', { recursive: true })
} else {
  console.warn(`prepare-assets: ${src} not found; MediaPipe wasm was not copied`)
}

const modelPath = 'public/models/hand_landmarker.task'
if (!existsSync(modelPath)) {
  try {
    const res = await fetch(MODEL_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    mkdirSync('public/models', { recursive: true })
    // write then rename, so an interrupted install never leaves a truncated model behind
    writeFileSync(`${modelPath}.tmp`, Buffer.from(await res.arrayBuffer()))
    renameSync(`${modelPath}.tmp`, modelPath)
  } catch (err) {
    console.warn(`prepare-assets: could not download hand model (${err}); the app will fall back to the remote URL`)
  }
}
