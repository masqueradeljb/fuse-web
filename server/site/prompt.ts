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
}

const json = (v: unknown) => JSON.stringify(v, null, 1)

/** Left site = content and structure; right site = visual style. */
export function buildPagePrompt(p: PagePromptInput): string {
  return [
    `You are a senior web designer. Build ONE fused landing page.`,
    ``,
    `CONTENT comes from ${p.contentName} (${p.contentUrl}): what the product is, its headline, copy, sections and product imagery.`,
    `STYLE comes from ${p.styleName} (${p.styleUrl}): color palette, typography, button and card shapes, radii, shadows, spacing, overall mood.`,
    `Result: ${p.contentName}'s product, presented as if ${p.styleName}'s design team built it. Invent a short fused brand name blending both names.`,
    ``,
    `Rules:`,
    `- Output ONLY a complete HTML document (<!doctype html> … </html>). No markdown, no explanation.`,
    `- All CSS in one <style> tag. Define the style tokens as CSS custom properties on :root and use them.`,
    `- No <script>, no inline event handlers, no iframes, no forms that submit anywhere.`,
    `- Fonts: use the style site's font-family names with sensible system fallbacks. You may add one Google Fonts <link> if a family is clearly a Google font.`,
    `- Sections: sticky nav (fused logo + 3–5 links), hero (headline, subhead, primary + secondary button, a product image), 3 feature cards, a CTA band, a footer.`,
    `- Put the fused logo in the nav and once in the hero: <img src="${p.logoUrl}" alt="fused logo">.`,
    `- Images: only use URLs from the content site's "images" list below (absolute https URLs). If none, use CSS shapes/gradients in the style palette instead.`,
    `- Copy: rewrite the content site's messaging in the style site's voice; keep it about the content site's product. Short and punchy.`,
    `- Responsive (single column under 720px). Accessible contrast.`,
    ``,
    `CONTENT site capture (${p.contentName}):`,
    p.content ? json({ content: p.content.content, images: p.content.images }) : `(capture unavailable — infer from the name and URL)`,
    ``,
    `STYLE site capture (${p.styleName}):`,
    p.style ? json({ tokens: p.style.tokens, content: { title: p.style.content.title, headline: p.style.content.headline } }) : `(capture unavailable — infer the style from the name and screenshot if given)`,
    ``,
    `Screenshots follow: first the CONTENT site, then the STYLE site (if available).`,
  ].join('\n')
}
