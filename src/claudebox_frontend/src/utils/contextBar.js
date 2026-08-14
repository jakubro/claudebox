/** Pure context-bar sizing - capped percent + min-visible bar width. */

/**
 * `barWidth` is clamped to a 2% floor so the bar stays visible at very low context use.
 * @param {number} lastContextTokens
 * @param {number} contextWindow
 * @returns {{ percent: number, barWidth: number }}
 */
export function computeContextBar(lastContextTokens, contextWindow) {
  const percent = Math.min(100, (lastContextTokens / contextWindow) * 100)
  return { percent, barWidth: Math.max(2, percent) }
}
