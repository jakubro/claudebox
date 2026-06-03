/** Collection utilities for array deduplication and grouping. */

/** Deduplicate items by identity, returning [{item, count}] preserving insertion order. */
export function deduplicateWithCounts(items) {
  const counts = new Map()
  for (const item of items) {
    counts.set(item, (counts.get(item) || 0) + 1)
  }
  return Array.from(counts, ([item, count]) => ({ item, count }))
}
