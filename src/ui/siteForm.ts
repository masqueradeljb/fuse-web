import { fetchUserSite } from '../sites/userSite'
import type { Site } from '../types'

/** A form with one text input: on submit, fetches that site's logo and hands back a Site. */
export function bindSiteForm(form: HTMLFormElement, status: HTMLElement, onSite: (site: Site) => void): void {
  const input = form.querySelector('input')
  if (!input) throw new Error('site form needs an <input>')
  const button = form.querySelector('button')
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const value = input.value.trim()
    if (!value) return
    status.textContent = 'Fetching logo…'
    input.disabled = true
    if (button) button.disabled = true
    try {
      const site = await fetchUserSite(value)
      status.textContent = ''
      input.value = ''
      onSite(site)
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err)
    } finally {
      input.disabled = false
      if (button) button.disabled = false
    }
  })
}
