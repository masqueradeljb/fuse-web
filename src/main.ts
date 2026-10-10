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
  onFuse: (a, b, fuseId) => {
    fuseClient.fuse(a, b).then(
      (result) => scene.setFuseResult(fuseId, result),
      (err) => {
        console.error('fuse failed', err)
        scene.setFuseError(fuseId)
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
