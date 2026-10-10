const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models'

export interface GenerateOptions {
  apiKey: string
  model: string
  /** Gemini 3 thinking level, e.g. 'low' (faster) or 'high' */
  thinking: string
}

export interface GenerateInput {
  prompt: string
  /** JPEG screenshots, content site first */
  screenshots: Buffer[]
}

/** Pulls the HTML document out of a model reply (fences, chatter). */
export function extractHtml(text: string): string {
  const start = text.search(/<!doctype html|<html[\s>]/i)
  const end = text.toLowerCase().lastIndexOf('</html>')
  if (start === -1 || end === -1 || end < start) throw new Error('the model did not return an HTML page')
  return text.slice(start, end + '</html>'.length)
}

const redact = (s: string) => s.replace(/AIza[0-9A-Za-z_-]{10,}/g, 'AIza…')

export async function generatePage(opts: GenerateOptions, input: GenerateInput, signal?: AbortSignal): Promise<string> {
  const parts: unknown[] = [{ text: input.prompt }]
  for (const shot of input.screenshots) parts.push({ inline_data: { mime_type: 'image/jpeg', data: shot.toString('base64') } })
  const r = await fetch(`${GEMINI}/${encodeURIComponent(opts.model)}:generateContent`, {
    method: 'POST',
    // key in a header, never in the URL
    headers: { 'x-goog-api-key': opts.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { thinkingConfig: { thinkingLevel: opts.thinking }, maxOutputTokens: 32768 },
    }),
    signal,
  })
  const json = (await r.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
    error?: { message?: string; status?: string }
  }
  if (r.status === 401 || r.status === 403) throw new Error('Gemini rejected the API key (check GEMINI_API_KEY on the dev server)')
  if (!r.ok) throw new Error(`Gemini: ${redact(json.error?.message ?? `HTTP ${r.status}`)}`)
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
  const u = json.usageMetadata
  console.log(`[site] ${opts.model} — ${u?.promptTokenCount ?? '?'} in / ${u?.candidatesTokenCount ?? '?'} out / ${u?.thoughtsTokenCount ?? 0} thinking tokens`)
  return extractHtml(text)
}
