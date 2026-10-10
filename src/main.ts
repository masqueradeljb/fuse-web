import './style.css'
import { gripConfig } from './config'
import { REFERENCE_SITES, SHELF_ROWS } from './data/sites'
import { DebugPanel } from './debug/DebugPanel'
import { PlaceholderFuseClient } from './fuse/FuseClient'
import { GestureEngine } from './gesture/GestureEngine'
import { MouseHand } from './input/MouseHand'
import { Renderer } from './render/Renderer'
import { Scene } from './scene/Scene'
import { HandTracker } from './tracking/HandTracker'
import { bindSiteForm } from './ui/siteForm'
import { bindOverlayClose, openFused } from './ui/fusedView'
import type { InputFrame, Site, TrackedHand } from './types'

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!
const video = document.querySelector<HTMLVideoElement>('#camera')!
const banner = document.querySelector<HTMLElement>('#banner')!
const hint = document.querySelector<HTMLElement>('#hint')!

const start = document.querySelector<HTMLElement>('#start')!
const startForm = document.querySelector<HTMLFormElement>('#start-form')!
const startStatus = document.querySelector<HTMLElement>('#start-status')!
const addForm = document.querySelector<HTMLFormElement>('#add-site')!
const addStatus = document.querySelector<HTMLElement>('#add-status')!
const overlay = document.querySelector<HTMLElement>('#fused-overlay')!

const fuseClient = new PlaceholderFuseClient()
let scene: Scene | null = null
const renderer = new Renderer(canvas, REFERENCE_SITES)
const engine = new GestureEngine(gripConfig)
const mouse = new MouseHand(canvas)
const debug = new DebugPanel(document.querySelector<HTMLElement>('#debug')!, gripConfig)

function resize() {
  renderer.resize(innerWidth, innerHeight)
  scene?.resize(innerWidth, innerHeight)
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
  } catch (err) {
    console.error('camera unavailable', err)
    showBanner('Camera unavailable — using mouse mode (drag logos with the mouse).')
    return
  }
  try {
    tracker = await HandTracker.create()
  } catch (err) {
    console.error('hand tracking failed to load', err)
    ;(video.srcObject as MediaStream).getTracks().forEach((t) => t.stop())
    video.srcObject = null
    showBanner('Hand tracking failed to load — using mouse mode. Try `npm install` again.')
  }
}

let bannerTimer: ReturnType<typeof setTimeout> | undefined
function showBanner(text: string, hideAfterMs?: number) {
  clearTimeout(bannerTimer)
  banner.textContent = text
  banner.hidden = false
  if (hideAfterMs) bannerTimer = setTimeout(() => (banner.hidden = true), hideAfterMs)
}

function startStage(site: Site) {
  start.hidden = true
  addForm.hidden = false
  renderer.addSite(site)
  scene = new Scene({
    leftSites: [site],
    rightSites: REFERENCE_SITES,
    rows: SHELF_ROWS,
    width: innerWidth,
    height: innerHeight,
    onFuse: (a, b, fuseId) => {
      fuseClient.fuse(a, b).then(
        (result) => scene?.setFuseResult(fuseId, result),
        (err) => {
          console.error('fuse failed', err)
          scene?.setFuseError(fuseId)
        },
      )
    },
    onOpenFused: (a, b) =>
      openFused(a, b, overlay, () =>
        showBanner('Pop-up blocked — showing it here. Allow pop-ups for this site to open fused pages in a new tab.', 6000),
      ),
  })
  void startCamera()
}

bindSiteForm(startForm, startStatus, (site) => startStage(site))
bindSiteForm(addForm, addStatus, (site) => {
  renderer.addSite(site)
  scene?.addLeftSite(site)
})
bindOverlayClose(overlay)

let hands: TrackedHand[] = []
let handFrame: InputFrame = { cursors: [], events: [] }
let lastErrorLog = 0

function frame(now: number) {
  requestAnimationFrame(frame)
  if (!scene) return
  try {
    const fresh = tracker?.detect(video, now, innerWidth, innerHeight)
    let handEvents: InputFrame['events'] = []
    if (fresh) {
      // New camera frame: advance the gesture engine once; its events are delivered exactly once.
      hands = fresh
      handFrame = engine.update(hands)
      handEvents = handFrame.events
      debug.record(hands)
    }
    const fromMouse = mouse.poll()
    const input: InputFrame = {
      cursors: [...handFrame.cursors, ...fromMouse.cursors],
      events: [...handEvents, ...fromMouse.events],
    }
    scene.update(now, input)
    debug.update(input.cursors)
    renderer.showDebug = debug.visible
    renderer.draw(scene, tracker ? video : null, hands)

    if (hands.length) lastHandSeen = now
    hint.hidden = !tracker || now - lastHandSeen < 3000
  } catch (err) {
    if (now - lastErrorLog > 1000) {
      lastErrorLog = now
      console.error('frame error', err)
    }
  }
}

requestAnimationFrame(frame)
