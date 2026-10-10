import type { SiteCapture } from './types'

export interface PagePromptInput {
  contentName: string
  styleName: string
  content: SiteCapture | null
  style: SiteCapture | null
  contentUrl: string
  styleUrl: string
  /** same-origin path to the fused logo */
  logoUrl: string
  /** same-origin path to the generated on-angle hero image */
  heroImageUrl: string
}

const json = (v: unknown) => JSON.stringify(v, null, 1)

/** Left site = the product; right site = the reference (style, structure, hero format, marketing angle). */
export function buildPagePrompt(p: PagePromptInput): string {
  const video = p.style?.hero.media === 'video' && p.style.hero.src ? p.style.hero : null
  const A = p.contentName
  const B = p.styleName
  return [
    `You are a senior web designer. Build ONE fused landing page.`,
    ``,
    `LEFT / PRODUCT = ${A} (${p.contentUrl}): what the product is, who it's for, its real facts and features, its logo.`,
    `RIGHT / REFERENCE = ${B} (${p.styleUrl}): visual style (tokens, typography, buttons, radii, spacing), page structure and section rhythm, hero format, and its marketing angle.`,
    ``,
    `First, silently identify (1) ${B}'s positioning angle in one sentence — the promise it makes to its audience (e.g. "economic opportunity for drivers"); (2) ${A}'s product and audience. Then write the page for ${A}'s audience using ${B}'s angle (e.g. "economic opportunity for builders"). Mirror ${B}'s hero layout and section order. Invent a short fused brand name blending both names.`,
    ``,
    `Rules:`,
    `- Output ONLY a complete HTML document (<!doctype html> … </html>). No markdown, no explanation.`,
    `- All CSS in one <style> tag. Define the style tokens as CSS custom properties on :root and use them.`,
    `- No <script>, no inline event handlers, no iframes, no forms that submit anywhere.`,
    `- Fonts: use the reference site's font-family names with sensible system fallbacks. You may add one Google Fonts <link> if a family is clearly a Google font.`,
    `- Structure: follow ${B}'s section order; typically sticky nav (fused logo + 3–5 links), hero in ${B}'s format, 3 feature cards, a CTA band, a footer.`,
    `- Put the fused logo in the nav only: <img src="${p.logoUrl}" alt="fused logo">. Don't repeat it elsewhere.`,
    `- Mirror ${B}'s hero elements exactly — include an eyebrow/badge/pill above the headline only if ${B}'s captured hero has a non-empty "eyebrow", and nothing ${B}'s hero doesn't have.`,
    `- Never invent decorative elements that neither site has (badges, pills, tag chips, announcement bars, icon rows, testimonials, logo walls, stats). Every element should trace back to ${B}'s structure or ${A}'s content.`,
    `- Hero visual: use <img src="${p.heroImageUrl}" alt=""> as the main hero visual.`,
    video
      ? `- Also place <video autoplay muted loop playsinline${video.poster ? ` poster="${video.poster}"` : ''} src="${video.src}"></video> as a full-bleed background behind the hero with a dark tint overlay so text stays readable.`
      : `- Do not use any <video>.`,
    `- Images: for feature sections use only URLs from ${A}'s "images" list below (absolute https URLs); never use ${B}'s images (the hero video above is the only exception). If none, use CSS shapes/gradients in the reference palette instead.`,
    `- Copy: rewrite ${A}'s messaging in ${B}'s voice and angle; keep the facts about ${A}'s product. Short and punchy.`,
    `- Responsive (single column under 720px). Accessible contrast.`,
    ``,
    `PRODUCT site capture (${A}):`,
    p.content
      ? json({ content: p.content.content, hero: p.content.hero, description: p.content.description, images: p.content.images })
      : `(capture unavailable — infer from the name and URL)`,
    ``,
    `REFERENCE site capture (${B}):`,
    p.style
      ? json({
          tokens: p.style.tokens,
          content: { title: p.style.content.title, headline: p.style.content.headline, sectionHeadings: p.style.content.sections.map((s) => s.heading) },
          hero: p.style.hero,
          description: p.style.description,
        })
      : `(capture unavailable — infer the style from the name and screenshot if given)`,
    ``,
    `Screenshots follow: first the PRODUCT site, then the REFERENCE site (if available).`,
  ].join('\n')
}
