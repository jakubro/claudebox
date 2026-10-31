/** The CSS colour an inline code span holds, for GitHub's three documented forms only. */

const HEX = /^#[0-9a-fA-F]{6}$/
const RGB = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/
const HSL = /^hsl\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*\)$/

/**
 * Return `text` as a CSS colour when it is wholly `#RRGGBB`, `rgb(R, G, B)` (0-255) or `hsl(H, S%, L%)`
 * (H 0-360, S and L 0-100); null otherwise, so only a validated value reaches a style.
 * @param {string} text
 * @returns {string|null}
 */
export function colorValue(text) {
  if (HEX.test(text)) {
    return text
  }
  const rgb = RGB.exec(text)
  if (rgb?.slice(1).every(c => Number(c) <= 255)) {
    return `rgb(${rgb[1]}, ${rgb[2]}, ${rgb[3]})`
  }
  const hsl = HSL.exec(text)
  if (hsl && Number(hsl[1]) <= 360 && Number(hsl[2]) <= 100 && Number(hsl[3]) <= 100) {
    return `hsl(${hsl[1]}, ${hsl[2]}%, ${hsl[3]}%)`
  }
  return null
}
