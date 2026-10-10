import './fused.css'
import { siteStatus, sitePageUrl, startSite, type PageStatus } from './fuse/siteJobs'
import { logoSrc } from './render/logoImages'
import type { Site } from './types'
import { readFusedPair } from './ui/fusedPair'

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && window.parent !== window) {
    window.parent.postMessage({ type: 'fuse-web:close-overlay' }, location.origin)
  }
})

const root = document.querySelector<HTMLElement>('#fused')!
const pair = readFusedPair(new URLSearchParams(location.search).get('pair') ?? '')

const POLL_MS = 1500
const STAGE_TEXT: Partial<Record<PageStatus, string>> = {
  capturing: 'capturing both sites…',
  generating: 'writing the fused page…',
}

/** Polls the page job; redirects when ready. */
async function watchPage(pageId: string, a: Site, b: Site, stage: HTMLElement, bar: HTMLElement, errBox: HTMLElement) {
  let restarted = false
  for (;;) {
    let r: { status: PageStatus; error?: string }
    try {
      r = await siteStatus(pageId)
    } catch {
      r = { status: 'capturing' } // transient network error: keep waiting
    }
    if (r.status === 'ready') {
      location.replace(sitePageUrl(pageId))
      return
    }
    root.style.visibility = '' // first answer was not 'ready': show the building view
    if (r.status === 'error') {
      bar.hidden = true
      stage.hidden = true
      errBox.hidden = false
      errBox.textContent = `The fused site couldn't be built: ${r.error ?? 'unknown error'}`
      return
    }
    if (r.status === 'unknown') {
      if (restarted) {
        stage.textContent = 'starting the fused site…'
      } else {
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
    } else {
      stage.textContent = STAGE_TEXT[r.status] ?? 'building…'
    }
    await new Promise((res) => setTimeout(res, POLL_MS))
  }
}

if (!pair) {
  root.textContent = 'Nothing fused yet — go back and fuse two sites.'
} else {
  const { a, b, logoUrl, pageId } = pair
  document.title = `${a.name} × ${b.name}`
  document.documentElement.style.setProperty('--a', a.color)
  document.documentElement.style.setProperty('--b', b.color)

  if (logoUrl) {
    const fused = document.createElement('img')
    fused.className = 'fused-logo'
    fused.alt = 'Fused logo'
    fused.src = logoUrl
    root.append(fused)
  }
  const marks = document.createElement('div')
  marks.className = logoUrl ? 'marks small' : 'marks'
  for (const site of [a, b]) {
    const img = document.createElement('img')
    img.alt = site.name
    img.src = logoSrc(site)
    if (site.logoUrl) {
      img.className = 'own'
      if (site.logoBg) img.style.background = site.logoBg
    }
    marks.append(img)
  }
  const title = document.createElement('h1')
  title.textContent = `${a.name} × ${b.name}`
  const note = document.createElement('p')
  note.textContent = pageId
    ? 'building the fused site…'
    : logoUrl
      ? 'Fused logo — the full fused site is coming soon.'
      : 'The fused site is coming soon.'
  root.append(marks, title, note)

  if (pageId) {
    const bar = document.createElement('div')
    bar.className = 'build-bar'
    bar.append(document.createElement('span'))
    const stage = document.createElement('p')
    stage.className = 'build-stage'
    stage.textContent = 'capturing both sites…'
    const errBox = document.createElement('p')
    errBox.className = 'build-error'
    errBox.hidden = true
    root.append(bar, stage, errBox)
    root.style.visibility = 'hidden' // no flash of the building view if the page is already ready
    void watchPage(pageId, a, b, stage, bar, errBox)
  }
}
