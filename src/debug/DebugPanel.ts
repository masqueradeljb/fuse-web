import type { GripConfig } from '../config'
import type { HandCursor, TrackedHand } from '../types'

/**
 * D: toggle panel + landmark dots. [ / ]: pinch threshold −/+. - / =: fist threshold −/+.
 * R: start/stop recording landmarks; stopping downloads a JSON file usable as test fixtures.
 */
export class DebugPanel {
  visible = false
  private recording: TrackedHand[][] | null = null

  constructor(
    private el: HTMLElement,
    private config: GripConfig,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      this.onKey(e.key)
    })
  }

  record(hands: TrackedHand[]): void {
    this.recording?.push(
      hands.map((h) => ({ id: h.id, landmarks: h.landmarks.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) })),
    )
  }

  update(cursors: HandCursor[]): void {
    this.el.hidden = !this.visible
    if (!this.visible) return
    const c = this.config
    const lines = [
      `pinch < ${c.pinchThreshold.toFixed(2)}   fist < ${c.fistThreshold.toFixed(2)}   ${this.recording ? '● REC' : ''}`,
      ...cursors.map(
        (h) =>
          `hand ${h.handId}: ${h.gripping ? 'GRIP' : 'open'}  pinch ${h.pinchRatio?.toFixed(2) ?? '–'}  fist ${h.fistRatio?.toFixed(2) ?? '–'}`,
      ),
      '[ ] pinch   - = fist   R record   D hide',
    ]
    this.el.textContent = lines.join('\n')
  }

  private onKey(key: string): void {
    const c = this.config
    const clamp = (v: number) => Math.round(Math.max(0.05, v) * 100) / 100
    switch (key.toLowerCase()) {
      case 'd':
        this.visible = !this.visible
        break
      case '[':
        c.pinchThreshold = clamp(c.pinchThreshold - 0.02)
        break
      case ']':
        c.pinchThreshold = clamp(c.pinchThreshold + 0.02)
        break
      case '-':
        c.fistThreshold = clamp(c.fistThreshold - 0.05)
        break
      case '=':
        c.fistThreshold = clamp(c.fistThreshold + 0.05)
        break
      case 'r':
        this.toggleRecording()
        break
    }
  }

  private toggleRecording(): void {
    if (!this.recording) {
      this.recording = []
      return
    }
    const blob = new Blob([JSON.stringify(this.recording)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `landmarks-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    this.recording = null
  }
}
