/**
 * One Euro filter (Casiez et al. 2012): heavy smoothing when still, light when moving fast.
 * Units: value in px, time in ms. beta is tuned for px/s speeds.
 */
export class OneEuroFilter {
  private xPrev: number | null = null
  private dxPrev = 0
  private tPrev = 0

  constructor(
    private minCutoff = 1.5,
    private beta = 0.02,
    private dCutoff = 1,
  ) {}

  filter(x: number, tMs: number): number {
    if (this.xPrev === null) {
      this.xPrev = x
      this.tPrev = tMs
      return x
    }
    const dt = Math.max((tMs - this.tPrev) / 1000, 1e-3)
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt)
    const dx = (x - this.xPrev) / dt
    const dxHat = this.dxPrev + alpha(this.dCutoff) * (dx - this.dxPrev)
    const xHat = this.xPrev + alpha(this.minCutoff + this.beta * Math.abs(dxHat)) * (x - this.xPrev)
    this.xPrev = xHat
    this.dxPrev = dxHat
    this.tPrev = tMs
    return xHat
  }
}
