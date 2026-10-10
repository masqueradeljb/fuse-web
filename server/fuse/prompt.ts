const clean = (name: string) => name.replace(/["\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)

/** Image 1 (left slot) gives the subject; image 2 (right slot) gives the style. */
export function buildFusePrompt(subjectName: string, styleName: string): string {
  const a = clean(subjectName)
  const b = clean(styleName)
  return [
    `Image 1 is the logo of ${a}. Image 2 is the logo of ${b}.`,
    `Create one new logo. Keep the main subject, character and shape of image 1 as the core mark,`,
    `redrawn in the visual style of image 2: its color palette, line weight, shape language and finish.`,
    `It should read clearly as ${a}'s mark in ${b}'s style.`,
    `Flat vector logo, centered, generous padding, plain white background, no text, no letters, no mockup.`,
  ].join(' ')
}
