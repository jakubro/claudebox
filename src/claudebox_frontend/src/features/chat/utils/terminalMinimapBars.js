/** Build the terminal overview's bars - one per command, by content, duration, exit status. */

import { normalizeWidths } from './normalizeMinimapWidths'
import { predictTerminalEntryHeight } from './predictTerminalEntryHeight'
import { metricsForEntry } from './terminalEntryMetrics'

/**
 * One bar per entry, oldest first: `height` from the virtualizer's own content prediction, `width`
 * from `normalizeWidths`, `status` from the failure predicate `TerminalEntry` renders from.
 *
 * @param {Array} entries - From `deriveTerminalEntries`, oldest first, trailing entry included.
 * @param {object} metricsCacheRef - Shared with the virtualizer, so content is extracted once.
 */
export function buildTerminalMinimapBars(entries, metricsCacheRef) {
  const bars = entries.map(entry => {
    const metrics = metricsForEntry(entry, metricsCacheRef)
    return {
      id: entry.id,
      height: predictTerminalEntryHeight(metrics),
      duration: entryDuration(entry),
      status: metrics.pending ? 'running' : metrics.isFailed ? 'failed' : 'passed',
    }
  })

  const [normalized] = normalizeWidths([{ turns: bars }])
  return normalized.turns
}

/** Result timestamp minus call timestamp; absent (not zero) when either half hasn't landed yet. */
function entryDuration(entry) {
  if (!(entry.callTs && entry.result?.ts)) {
    return null
  }
  return new Date(entry.result.ts).getTime() - new Date(entry.callTs).getTime()
}
