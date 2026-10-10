export interface Point {
  x: number
  y: number
}

/** 21 hand landmarks in screen pixels, already mirrored. Indices follow MediaPipe. */
export type Landmarks = Point[]

export interface TrackedHand {
  id: number
  landmarks: Landmarks
}

export type GripKind = 'pinch' | 'fist'

export interface HandCursor {
  handId: number
  point: Point
  gripping: boolean
  /** live ratios for the debug panel; absent for the mouse */
  pinchRatio?: number
  fistRatio?: number
}

export type GripEvent =
  | { type: 'gripStart'; handId: number; point: Point }
  | { type: 'gripEnd'; handId: number; point: Point }

/** What one input source produces per frame. Hands and mouse both emit this. */
export interface InputFrame {
  cursors: HandCursor[]
  events: GripEvent[]
}

export interface Site {
  id: string
  name: string
  url: string
  /** brand color as #RRGGBB */
  color: string
  /** SVG path data in a 24×24 viewBox */
  iconPath: string
}
