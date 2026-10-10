export interface SiteTokens {
  background: string
  text: string
  accent: string
  headingFont: string
  bodyFont: string
  h1Size: string
  radius: string
  shadow: string
  button: { background: string; color: string; radius: string; padding: string; fontWeight: string }
}

export interface SiteContent {
  title: string
  headline: string
  subhead: string
  ctas: string[]
  nav: string[]
  sections: { heading: string; text: string }[]
}

export interface SiteHero {
  eyebrow: string
  headline: string
  subhead: string
  cta: string
  media: 'video' | 'image' | 'background' | 'none'
  /** absolute http(s) URL of the hero video/image/background (never blob:) */
  src?: string
  /** video poster, if any */
  poster?: string
}

export interface SiteCapture {
  url: string
  tokens: SiteTokens
  content: SiteContent
  /** absolute URLs, largest first */
  images: string[]
  logo?: string
  hero: SiteHero
  /** meta description */
  description: string
  ogImage?: string
  /** the site served a bot-check page; only title/description/ogImage are from a plain fetch */
  blocked?: boolean
}
