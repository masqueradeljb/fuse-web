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

export const SHELF_ROWS = 6

const site = (icon: SimpleIcon, url: string): Site => ({
  id: icon.slug,
  name: icon.title,
  url,
  color: `#${icon.hex}`,
  iconPath: icon.path,
})

/** Reference sites for the right shelf (2 columns of SHELF_ROWS). The right slot starts with the first. */
export const REFERENCE_SITES: Site[] = [
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
  site(siUber, 'https://www.uber.com/us/en/drive/'),
  site(siReddit, 'https://www.reddit.com'),
]
