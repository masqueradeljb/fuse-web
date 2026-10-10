import {
  siAirbnb,
  siApple,
  siDiscord,
  siDuolingo,
  siFigma,
  siGithub,
  siNetflix,
  siNotion,
  siReddit,
  siSpotify,
  siStripe,
  siUber,
  type SimpleIcon,
} from 'simple-icons'
import type { Site } from '../types'

export const PER_SHELF = 6

const site = (icon: SimpleIcon, url: string): Site => ({
  id: icon.slug,
  name: icon.title,
  url,
  color: `#${icon.hex}`,
  iconPath: icon.path,
})

/** First PER_SHELF go on the left shelf, the rest on the right. Slots start with the first of each. */
export const SITES: Site[] = [
  site(siSpotify, 'https://www.spotify.com'),
  site(siStripe, 'https://stripe.com'),
  site(siGithub, 'https://github.com'),
  site(siDuolingo, 'https://www.duolingo.com'),
  site(siDiscord, 'https://discord.com'),
  site(siApple, 'https://www.apple.com'),
  site(siAirbnb, 'https://www.airbnb.com'),
  site(siNetflix, 'https://www.netflix.com'),
  site(siNotion, 'https://www.notion.com'),
  site(siFigma, 'https://www.figma.com'),
  site(siUber, 'https://www.uber.com'),
  site(siReddit, 'https://www.reddit.com'),
]
