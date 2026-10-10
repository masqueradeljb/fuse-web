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
  /** push depth (0–1 past contact) below which a collision doesn't charge */
  chargeMinPush: 0.08,
  /** charge per second at the minimum push… */
  chargeBase: 0.8,
  /** …plus this × push depth */
  chargeGain: 2.2,
  /** charge lost per second when not pushing */
  chargeDecay: 1.5,
  /** spring follow rate, per second */
  followStiffness: 18,
  /** fly-back animation length */
  returnMs: 300,
  /** fraction of height at the top (open fused page) and bottom (dismiss) where a held card triggers */
  cardZone: 0.15,
  /** held logos render this much bigger */
  heldScale: 1.1,
}
export type SceneConfig = typeof sceneConfig
