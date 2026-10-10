import './fused.css'
import { logoSrc } from './render/logoImages'
import { readFusedPair } from './ui/fusedPair'

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && window.parent !== window) {
    window.parent.postMessage({ type: 'fuse-web:close-overlay' }, location.origin)
  }
})

const root = document.querySelector<HTMLElement>('#fused')!
const pair = readFusedPair(new URLSearchParams(location.search).get('pair') ?? '')

if (!pair) {
  root.textContent = 'Nothing fused yet — go back and fuse two sites.'
} else {
  const [a, b] = pair
  document.title = `${a.name} × ${b.name}`
  document.documentElement.style.setProperty('--a', a.color)
  document.documentElement.style.setProperty('--b', b.color)

  const marks = document.createElement('div')
  marks.className = 'marks'
  for (const site of pair) {
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
  note.textContent = 'The fused site is coming soon.'
  root.append(marks, title, note)
}
