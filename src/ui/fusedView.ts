import type { Site } from '../types'
import { saveFusedPair } from './fusedPair'

/**
 * Opens the fused page in a new tab. A hand gesture isn't a user activation, so Chrome may
 * block the pop-up — then the page shows in the in-app overlay instead.
 */
export function openFused(a: Site, b: Site, overlay: HTMLElement, onBlocked: () => void, logoUrl?: string): void {
  const url = `/fused.html?pair=${encodeURIComponent(saveFusedPair(a, b, localStorage, logoUrl))}`
  if (window.open(url, '_blank')) return
  const frame = overlay.querySelector('iframe')
  if (frame) frame.src = url
  overlay.hidden = false
  onBlocked()
}

export function bindOverlayClose(overlay: HTMLElement): void {
  const close = () => {
    overlay.hidden = true
    const frame = overlay.querySelector('iframe')
    if (frame) frame.src = 'about:blank'
  }
  overlay.querySelector('button')?.addEventListener('click', close)
  window.addEventListener('message', (e) => {
    if (e.origin === location.origin && e.data?.type === 'fuse-web:close-overlay') close()
  })
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) close()
  })
}
