/** Pure helper: format a Lookups panel's gathered entries as a per-tool count summary. */

import { normalizeToolName } from '../../../../../../../../../../config/schema'

/**
 * Builds the Lookups chrome summary string: per-tool counts in first-appearance order, e.g. "Read x3, Grep x1".
 * @param {Array<{block: object}>} entries - Gathered segments, in call order.
 * @returns {string} Comma-joined `Name xN` pairs.
 */
export function formatLookupsSummary(entries) {
  const counts = new Map()
  for (const { block } of entries) {
    const name = normalizeToolName(block.toolUse?.content)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts].map(([name, n]) => `${name} x${n}`).join(', ')
}
