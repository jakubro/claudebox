/** Windowed terminal column - mounts viewport+overscan entries and prices the rest by prediction. */

import { useCallback, useRef } from 'react'
import { AUTOSCROLL_THRESHOLD, TERMINAL_OVERSCAN } from '../../../config/dimensions'
import { predictTerminalEntryHeight } from '../utils/predictTerminalEntryHeight'
import { metricsForEntry } from '../utils/terminalEntryMetrics'
import { useVirtualizerGeometry, useWindowedVirtualizer } from './useVirtualListGeometry'

/**
 * Window the terminal column's entries against its own scroll container, following the same
 * shape as `useTurnVirtualizer` (see that hook for the rationale behind each option below).
 *
 * `entries` here excludes the trailing entry - callers keep it out of the window and render it
 * directly, since it is the one whose height still changes as "Running..." becomes real output.
 *
 * @param {object} [metricsCacheRef] - Shared entry-metrics cache, falling back to a local one;
 *   `TerminalColumn` passes the ref its overview uses so content is extracted once.
 */
export default function useTerminalVirtualizer({
  containerEl,
  listRef,
  entries,
  metricsCacheRef: externalMetricsCacheRef,
}) {
  // `.terminal-column` is itself the scroll element and carries its own padding, so the list's
  // top sits inset from the scroll container's top by that padding - measured, not hardcoded.
  const { scrollEl, initialRect, scrollMargin } = useVirtualizerGeometry(containerEl, listRef)

  const ownMetricsCacheRef = useRef(new Map())
  const metricsCacheRef = externalMetricsCacheRef || ownMetricsCacheRef

  const estimateSize = useCallback(
    index => {
      const entry = entries[index]
      return entry ? predictTerminalEntryHeight(metricsForEntry(entry, metricsCacheRef)) : 0
    },
    [entries, metricsCacheRef],
  )

  const getItemKey = useCallback(index => entries[index]?.id ?? index, [entries])

  const virtualizer = useWindowedVirtualizer({
    count: entries.length,
    scrollEl,
    estimateSize,
    getItemKey,
    initialRect,
    scrollMargin,
    overscan: TERMINAL_OVERSCAN,
    // Stay-put and follow-new-entry-at-bottom, from virtual-core rather than a hand-rolled loop.
    extraOptions: {
      anchorTo: 'end',
      followOnAppend: true,
      scrollEndThreshold: AUTOSCROLL_THRESHOLD,
    },
  })

  const virtualItems = virtualizer.getVirtualItems()

  return {
    virtualizer,
    virtualItems,
    scrollMargin,
    windowed: entries.length === 0 || virtualItems.length > 0,
  }
}
