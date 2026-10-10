import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import type { Point, TrackedHand } from '../types'
import { assignIds, type PrevHand } from './assignIds'
import { coverRect, toScreen } from './coords'
import { OneEuroFilter } from './oneEuro'

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
const LOCAL_MODEL_PATH = '/models/hand_landmarker.task'

/** Prefer the model fetched at install time (works offline); fall back to the remote copy. */
async function resolveModelPath(): Promise<string> {
  try {
    const res = await fetch(LOCAL_MODEL_PATH, { method: 'HEAD' })
    // Vite's dev server answers unknown paths with index.html (200), so check the content type too.
    if (res.ok && !(res.headers.get('content-type') ?? '').includes('text/html')) return LOCAL_MODEL_PATH
  } catch {
    // network or fetch failure: use the remote URL
  }
  return MODEL_URL
}

function createLandmarker(
  fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
  modelAssetPath: string,
  delegate: 'GPU' | 'CPU',
): Promise<HandLandmarker> {
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
  })
}

/** keep a vanished hand's id this many video frames so a brief dropout doesn't reset it */
const KEEP_LOST_FRAMES = 6

export class HandTracker {
  private filters = new Map<number, OneEuroFilter[]>()
  private known: (PrevHand & { lastFrame: number })[] = []
  private nextId = 1
  private frame = 0
  private lastVideoTime = -1
  private lastHands: TrackedHand[] = []

  private constructor(private landmarker: HandLandmarker) {}

  static async create(): Promise<HandTracker> {
    const fileset = await FilesetResolver.forVisionTasks('/mediapipe-wasm')
    const modelPath = await resolveModelPath()
    try {
      return new HandTracker(await createLandmarker(fileset, modelPath, 'GPU'))
    } catch (err) {
      console.warn('HandLandmarker GPU delegate failed, retrying on CPU', err)
      return new HandTracker(await createLandmarker(fileset, modelPath, 'CPU'))
    }
  }

  /** Hands in mirrored screen px. Returns the previous result if the video has no new frame. */
  detect(video: HTMLVideoElement, nowMs: number, viewW: number, viewH: number): TrackedHand[] {
    if (video.readyState < 2 || video.currentTime === this.lastVideoTime) return this.lastHands
    this.lastVideoTime = video.currentTime
    this.frame++

    const result = this.landmarker.detectForVideo(video, nowMs)
    const rect = coverRect(video.videoWidth, video.videoHeight, viewW, viewH)
    const raw = result.landmarks.map((hand) => hand.map((l) => toScreen(l.x, l.y, rect, viewW)))
    const { ids, nextId } = assignIds(this.known, raw.map((lm) => lm[0]), this.nextId, Math.max(viewW, viewH) * 0.2)
    this.nextId = nextId
    const hands = raw.map((lm, i) => ({ id: ids[i], landmarks: this.smooth(ids[i], lm, nowMs) }))

    for (const h of hands) {
      const k = this.known.find((k) => k.id === h.id)
      if (k) {
        k.wrist = h.landmarks[0]
        k.lastFrame = this.frame
      } else {
        this.known.push({ id: h.id, wrist: h.landmarks[0], lastFrame: this.frame })
      }
    }
    this.known = this.known.filter((k) => this.frame - k.lastFrame <= KEEP_LOST_FRAMES)
    for (const id of [...this.filters.keys()]) {
      if (!this.known.some((k) => k.id === id)) this.filters.delete(id)
    }

    this.lastHands = hands
    return hands
  }

  private smooth(id: number, lm: Point[], tMs: number): Point[] {
    let f = this.filters.get(id)
    if (!f) {
      f = Array.from({ length: lm.length * 2 }, () => new OneEuroFilter())
      this.filters.set(id, f)
    }
    const filters = f
    return lm.map((p, i) => ({ x: filters[2 * i].filter(p.x, tMs), y: filters[2 * i + 1].filter(p.y, tMs) }))
  }
}
