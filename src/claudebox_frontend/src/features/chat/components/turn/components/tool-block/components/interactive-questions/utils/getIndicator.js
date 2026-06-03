/** Selection indicator glyph for interactive-question options. */

/**
 * Return the Unicode glyph that represents the option's selection state.
 *
 * @param {boolean} multiSelect - Use checkbox glyph instead of radio.
 * @param {boolean} isSelected - Whether the option is currently selected.
 * @returns {string} Single-character indicator (☑ ☐ ● ○).
 */
export function getIndicator(multiSelect, isSelected) {
  if (multiSelect) {
    return isSelected ? '☑' : '☐'
  }
  return isSelected ? '●' : '○'
}
