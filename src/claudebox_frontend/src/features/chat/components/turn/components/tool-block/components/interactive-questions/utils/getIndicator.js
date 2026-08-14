/** Selection indicator glyph for interactive-question options. */

/**
 * @param {boolean} multiSelect - Use checkbox glyph instead of radio.
 * @returns {string} Single-character indicator (☑ ☐ ● ○).
 */
export function getIndicator(multiSelect, isSelected) {
  if (multiSelect) {
    return isSelected ? '☑' : '☐'
  }
  return isSelected ? '●' : '○'
}
