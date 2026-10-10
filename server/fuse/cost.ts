/** USD per 1M tokens. Hard-coded on purpose so price changes show up in diffs. */
export const PRICE: Record<string, { tin: number; iin: number; out: number }> = {
  'gpt-image-2.5-sunburst': { tin: 5, iin: 8, out: 30 },
  'gpt-image-2.5-flare': { tin: 5, iin: 8, out: 30 },
  'gpt-image-2': { tin: 5, iin: 8, out: 30 },
}
export const PRICE_AS_OF = '2026-09-09'

export interface Usage {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: { text_tokens?: number; image_tokens?: number }
}

/** Without input details, all input is priced as text — a lower bound (exact: false). */
export function costOf(model: string, usage: Usage): { usd: number | null; exact: boolean } {
  const p = PRICE[model]
  const details = usage.input_tokens_details
  const text = details ? (details.text_tokens ?? 0) : (usage.input_tokens ?? 0)
  const image = details ? (details.image_tokens ?? 0) : 0
  const out = usage.output_tokens ?? 0
  return { usd: p ? (text * p.tin + image * p.iin + out * p.out) / 1e6 : null, exact: details !== undefined }
}
