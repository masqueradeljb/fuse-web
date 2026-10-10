import type { FuseOptions } from '../fuse/options'

const OPENAI_EDITS = 'https://api.openai.com/v1/images/edits'
const TIMEOUT_MS = 150_000

export interface HeroInput {
  productName: string
  productSummary: string
  styleName: string
  /** the reference site's hero visual */
  reference: Buffer
  referenceType: 'image/png' | 'image/jpeg'
}

const redact = (s: string) => s.replace(/sk-[A-Za-z0-9_*-]+/g, 'sk-…')

export function buildHeroPrompt(i: Pick<HeroInput, 'productName' | 'productSummary' | 'styleName'>): string {
  return (
    `This image is the hero visual from ${i.styleName}'s landing page. Create a new hero image with the same composition, framing, lighting, color grading and mood, ` +
    `but about ${i.productName}: ${i.productSummary}. Show its audience in the same role the reference shows its audience. ` +
    `Photographic if the reference is photographic, illustrated if illustrated. No text, no letters, no logos, no UI.`
  )
}

/** On-angle hero image via OpenAI image edits; returns the PNG. */
export async function generateHero(options: FuseOptions, input: HeroInput, signal?: AbortSignal): Promise<Buffer> {
  if (!options.apiKey) throw new Error('OPENAI_API_KEY is not set')
  const form = new FormData()
  form.append('model', options.model)
  form.append('prompt', buildHeroPrompt(input))
  form.append('size', '1536x1024')
  form.append('quality', options.quality)
  form.append('n', '1')
  const ext = input.referenceType === 'image/png' ? 'png' : 'jpg'
  form.append('image[]', new Blob([new Uint8Array(input.reference)], { type: input.referenceType }), `reference.${ext}`)
  const r = await fetch(OPENAI_EDITS, {
    method: 'POST',
    headers: { authorization: `Bearer ${options.apiKey}` },
    body: form,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
  })
  const json = (await r.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; error?: { message?: string } }
  if (r.status === 401 || r.status === 403) throw new Error('OpenAI rejected the API key (check OPENAI_API_KEY on the dev server)')
  const b64 = json.data?.[0]?.b64_json
  if (!r.ok || !b64) throw new Error(`OpenAI: ${redact(json.error?.message ?? `HTTP ${r.status}`)}`)
  return Buffer.from(b64, 'base64')
}
