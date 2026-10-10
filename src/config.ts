/** Grip thresholds. Mutable on purpose: the debug panel tunes them live. */
export const gripConfig = {
  /** pinch when thumb–index distance < this × hand scale */
  pinchThreshold: 0.3,
  /** fist when mean fingertip–wrist distance < this × hand scale */
  fistThreshold: 0.9,
  /** release only above threshold × this */
  releaseFactor: 1.3,
  /** consecutive camera frames below threshold to start a grip */
  startFrames: 2,
  /** consecutive camera frames above release threshold to end a grip */
  endFrames: 3,
  /** camera frames (~30 fps) a hand may vanish before its grip is dropped (≈200 ms) */
  lostGraceFrames: 6,
}
export type GripConfig = typeof gripConfig

export const sceneConfig = {
  /** hover/grab radius = logo radius × this */
  hoverFactor: 1.3,
  /** two held logos fuse when closer than this × slot diameter */
  fuseDistanceFactor: 1.2,
  /** spring follow rate, per second */
  followStiffness: 18,
  /** fly-back animation length */
  returnMs: 300,
  /** fraction of width at each edge where dropping the result card dismisses it */
  dismissEdge: 0.15,
  /** held logos render this much bigger */
  heldScale: 1.1,
}
export type SceneConfig = typeof sceneConfig
