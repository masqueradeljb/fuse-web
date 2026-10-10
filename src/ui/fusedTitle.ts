import type { Site } from '../types'

const SHOW_MS = 4500
let hideTimer: ReturnType<typeof setTimeout> | undefined

/** Big "A × B — fused!" pill, top-center; hides itself after a few seconds. */
export function showFusedTitle(el: HTMLElement, a: Site, b: Site): void {
  clearTimeout(hideTimer)
  el.style.setProperty('--a', a.color)
  el.style.setProperty('--b', b.color)
  el.querySelector('strong')!.textContent = `${a.name} × ${b.name}`
  el.querySelector('span')!.textContent = 'fused! · pull ↑ to open · ↓ to dismiss'
  // restart the entrance animation even if the title is already showing
  el.classList.remove('show', 'leaving')
  el.hidden = false
  void el.offsetWidth
  el.classList.add('show')
  hideTimer = setTimeout(() => hideFusedTitle(el), SHOW_MS)
}

export function hideFusedTitle(el: HTMLElement): void {
  clearTimeout(hideTimer)
  if (el.hidden || el.classList.contains('leaving')) return
  el.classList.add('leaving')
  hideTimer = setTimeout(() => {
    el.hidden = true
    el.classList.remove('show', 'leaving')
  }, 400)
}
