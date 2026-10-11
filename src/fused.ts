import './fused.css'
import { siteStatus, sitePageUrl, startSite, type PageStatus } from './fuse/siteJobs'
import { logoSrc } from './render/logoImages'
import type { Site } from './types'
import { readFusedPair } from './ui/fusedPair'
import { startBackdrop } from './ui/startBackdrop'

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && window.parent !== window) {
    window.parent.postMessage({ type: 'fuse-web:close-overlay' }, location.origin)
  }
})

const root = document.querySelector<HTMLElement>('#fused')!
const pair = readFusedPair(new URLSearchParams(location.search).get('pair') ?? '')

const POLL_MS = 1500
/** the build, in order; each status lights the steps before it */
const STEPS = ['capturing both sites', 'writing the fused page', 'opening it'] as const
const STEP_OF: Partial<Record<PageStatus, number>> = { capturing: 0, unknown: 0, generating: 1, ready: 2 }

interface BuildView {
  steps: HTMLLIElement[]
  clock: HTMLElement
  progress: HTMLElement
  errBox: HTMLElement
}

function setStep(view: BuildView, active: number) {
  view.steps.forEach((li, i) => {
    li.dataset.state = i < active ? 'done' : i === active ? 'active' : 'todo'
  })
}

/** Polls the page job; redirects when ready. */
async function watchPage(pageId: string, a: Site, b: Site, view: BuildView) {
  let restarted = false
  const started = performance.now()
  const tick = setInterval(() => {
    const s = Math.floor((performance.now() - started) / 1000)
    view.clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }, 250)
  for (;;) {
    let r: { status: PageStatus; error?: string }
    try {
      r = await siteStatus(pageId)
    } catch {
      r = { status: 'capturing' } // transient network error: keep waiting
    }
    if (r.status === 'ready') {
      setStep(view, 2)
      location.replace(sitePageUrl(pageId))
      return
    }
    root.style.visibility = '' // first answer was not 'ready': show the building view
    if (r.status === 'error') {
      clearInterval(tick)
      view.progress.hidden = true
      view.errBox.hidden = false
      view.errBox.querySelector('span')!.textContent = r.error ?? 'unknown error'
      return
    }
    if (r.status === 'unknown') {
      if (!restarted) {
        restarted = true // server restarted and forgot the job: start it again once
        try {
          const j = await startSite(a, b)
          if (j.status === 'ready') {
            location.replace(sitePageUrl(pageId))
            return
          }
        } catch {
          // keep polling
        }
      }
    }
    setStep(view, STEP_OF[r.status] ?? 0)
    await new Promise((res) => setTimeout(res, POLL_MS))
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

if (!pair) {
  root.append(el('h1', 'display', 'Nothing fused yet'), el('p', 'lede', 'Go back to the stage and push two logos together.'))
} else {
  const { a, b, logoUrl, pageId } = pair
  document.title = `${a.name} × ${b.name}`
  document.documentElement.style.setProperty('--a', a.color)
  document.documentElement.style.setProperty('--b', b.color)
  startBackdrop(document.querySelector<HTMLCanvasElement>('#backdrop')!, [a, b], {
    quiet: { cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.36 },
  })

  if (logoUrl) {
    const fused = el('img', 'fused-logo')
    fused.alt = `Fused ${a.name} × ${b.name} logo`
    fused.src = logoUrl
    root.append(fused)
  } else {
    const marks = el('div', 'marks')
    for (const site of [a, b]) {
      const img = el('img')
      img.alt = site.name
      img.src = logoSrc(site)
      img.style.background = site.logoUrl ? (site.logoBg ?? '#fff') : site.color
      marks.append(img)
    }
    root.append(marks)
  }

  const title = el('h1', 'display')
  title.append(a.name, ' ', el('em', '', '×'), ' ', b.name)
  root.append(title)

  if (!pageId) {
    root.append(el('p', 'lede', logoUrl ? 'Fused logo. The full fused site is coming soon.' : 'The fused site is coming soon.'))
  } else {
    root.append(el('p', 'lede', `${a.name}'s product, told in ${b.name}'s style.`))
    const progress = el('div', 'build')
    const list = el('ol', 'steps')
    const steps = STEPS.map((label) => {
      const li = el('li')
      li.append(el('i'), el('span', '', label))
      list.append(li)
      return li
    })
    const clock = el('span', '', '0:00')
    const meta = el('p', 'mono-note')
    meta.append(clock, ' · usually under a minute')
    progress.append(list, meta)
    const errBox = el('p', 'build-error')
    errBox.append("The fused site couldn't be built: ", el('span'))
    errBox.hidden = true
    root.append(progress, errBox)
    const view: BuildView = { steps, clock, progress, errBox }
    setStep(view, 0)
    root.style.visibility = 'hidden' // no flash of the building view if the page is already ready
    void watchPage(pageId, a, b, view)
  }
}
