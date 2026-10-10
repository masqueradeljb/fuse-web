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

export interface SiteCapture {
  url: string
  tokens: SiteTokens
  content: SiteContent
  /** absolute URLs, largest first */
  images: string[]
  logo?: string
}
