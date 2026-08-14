/** Cap input history to bounded entries and total size, evicting oldest first. */

/**
 * Trim history (newest-last) to the entry and byte caps.
 * @param {string[]} history
 * @param {{maxEntries: number, maxBytes: number}} limits
 * @returns {string[]}
 */
export function capHistory(history, { maxEntries, maxBytes }) {
  const byCount = history.length > maxEntries ? history.slice(history.length - maxEntries) : history

  let totalBytes = byCount.reduce((sum, entry) => sum + _estimatedBytes(entry), 0)
  let start = 0

  // Never drop the last remaining entry, even if it alone exceeds maxBytes -
  // a cap must not make a non-empty history look empty.
  while (totalBytes > maxBytes && start < byCount.length - 1) {
    totalBytes -= _estimatedBytes(byCount[start])
    start += 1
  }

  return start > 0 ? byCount.slice(start) : byCount
}

/** Approximate storage cost of a string - 2 bytes per UTF-16 code unit. */
function _estimatedBytes(str) {
  return str.length * 2
}
