import './style.css'
import { gripConfig } from './config'
import { REFERENCE_SITES, SHELF_ROWS } from './data/sites'
import { DebugPanel } from './debug/DebugPanel'
import { AiFuseClient, NoKeyError } from './fuse/AiFuseClient'
import { PlaceholderFuseClient, type FuseResult } from './fuse/FuseClient'
import { GestureEngine } from './gesture/GestureEngine'
import { MouseHand } from './input/MouseHand'
import { Renderer } from './render/Renderer'
import { Scene } from './scene/Scene'
import { HandTracker } from './tracking/HandTracker'
import { bindSiteForm } from './ui/siteForm'
import { bindOverlayClose, openFused } from './ui/fusedView'
import { hideFusedTitle, showFusedTitle } from './ui/fusedTitle'
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
const fusedTitle = document.querySelector<HTMLElement>('#fused-title')!

const fuseClient = new AiFuseClient()
/** used when the dev server has no OpenAI key */
const fallback = new PlaceholderFuseClient(0)
/** in-flight fusions, aborted when their card is dismissed */
const pending = new Map<number, AbortController>()
let noKeyNoticeShown = false
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
let bannerSaved: { text: string; hidden: boolean } | null = null
function showBanner(text: string, hideAfterMs?: number) {
  clearTimeout(bannerTimer)
  // a timed message restores whatever the banner showed before (e.g. the camera notice)
  if (hideAfterMs) bannerSaved ??= { text: banner.textContent ?? '', hidden: banner.hidden === true }
  else bannerSaved = null
  banner.textContent = text
  banner.hidden = false
  if (hideAfterMs) {
    bannerTimer = setTimeout(() => {
      banner.textContent = bannerSaved?.text ?? ''
      banner.hidden = bannerSaved?.hidden ?? true
      bannerSaved = null
    }, hideAfterMs)
  }
}

/** Hands a result to the scene once its logo can be drawn, so the burst and the reveal line up. */
async function deliver(a: Site, b: Site, fuseId: number, result: FuseResult) {
  if (result.logoUrl) await renderer.prepareResult(result.logoUrl)
  if (scene?.fuse?.id !== fuseId) return
  scene.setFuseResult(fuseId, result)
  showFusedTitle(fusedTitle, a, b)
}

async function runFuse(a: Site, b: Site, fuseId: number) {
  const ctrl = new AbortController()
  pending.set(fuseId, ctrl)
  try {
    await deliver(a, b, fuseId, await fuseClient.fuse(a, b, ctrl.signal))
  } catch (err) {
    if (ctrl.signal.aborted || (err as Error)?.name === 'AbortError') return
    if (err instanceof NoKeyError) {
      if (!noKeyNoticeShown) {
        noKeyNoticeShown = true
        showBanner('No OpenAI key on the dev server (see README) — showing a placeholder fuse.', 6000)
      }
      await deliver(a, b, fuseId, await fallback.fuse(a, b))
      return
    }
    console.error('fuse failed', err)
    showBanner(err instanceof Error ? err.message : 'Fusion failed', 6000)
    scene?.setFuseError(fuseId)
  } finally {
    pending.delete(fuseId)
  }
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
    onFuse: (a, b, fuseId) => void runFuse(a, b, fuseId),
    onFuseDismissed: (fuseId) => {
      pending.get(fuseId)?.abort()
      pending.delete(fuseId)
      hideFusedTitle(fusedTitle)
    },
    onOpenFused: (a, b, result) =>
      openFused(
        a,
        b,
        overlay,
        () => showBanner('Pop-up blocked — showing it here. Allow pop-ups for this site to open fused pages in a new tab.', 6000),
        result?.logoUrl,
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
    // the fused overlay covers the stage: hands and mouse must not reach it
    scene.update(now, overlay.hidden ? input : { cursors: [], events: [] })
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
