/**
 * A logo's brand color from RGBA pixels: saturation-weighted average of opaque pixels,
 * ignoring near-white (backgrounds) and near-black. All-black logos → #111111.
 */
export function dominantColor(rgba: Uint8ClampedArray, fallback = '#888888'): string {
  let r = 0
  let g = 0
  let b = 0
  let weight = 0
  let dark = 0
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue
    const [R, G, B] = [rgba[i], rgba[i + 1], rgba[i + 2]]
    const max = Math.max(R, G, B)
    const min = Math.min(R, G, B)
    if (min > 235) continue
    if (max < 24) {
      dark++
      continue
    }
    const w = max - min + 8
    r += R * w
    g += G * w
    b += B * w
    weight += w
  }
  if (!weight) return dark ? '#111111' : fallback
  const hex = (v: number) => Math.round(v / weight).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}
