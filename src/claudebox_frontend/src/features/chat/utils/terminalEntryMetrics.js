/** Cached per-entry metrics - shared by the virtualizer's estimate and the overview's bars. */

import { deriveEntryMetrics } from './predictTerminalEntryHeight'

/**
 * Extraction is the expensive part of pricing an entry, so the result is cached by id in the ref
 * the caller supplies. A pending entry bypasses the cache, which would go stale on its result.
 */
export function metricsForEntry(entry, cacheRef) {
  if (!entry.result) {
    return deriveEntryMetrics(entry)
  }

  const cached = cacheRef.current.get(entry.id)
  if (cached) {
    return cached
  }

  const metrics = deriveEntryMetrics(entry)
  cacheRef.current.set(entry.id, metrics)
  return metrics
}
