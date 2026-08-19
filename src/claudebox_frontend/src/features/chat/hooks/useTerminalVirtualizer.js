/** Windowed terminal column - mounts viewport+overscan entries and prices the rest by prediction. */

import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useMemo, useRef } from 'react'
import { AUTOSCROLL_THRESHOLD, TERMINAL_OVERSCAN } from '../../../config/dimensions'
import { deriveEntryMetrics, predictTerminalEntryHeight } from '../utils/predictTerminalEntryHeight'
import {
  measureRoundedElement,
  useMirroredScrollElement,
  useScrollMargin,
} from './useVirtualListGeometry'

/**
 * Window the terminal column's entries against its own scroll container, following the same
 * shape as `useTurnVirtualizer` (see that hook for the rationale behind each option below).
 *
 * `entries` here excludes the trailing entry - callers keep it out of the window and render it
 * directly, since it is the one whose height still changes as "Running..." becomes real output.
 */
export default function useTerminalVirtualizer({ containerRef, listRef, entries }) {
  const scrollEl = useMirroredScrollElement(containerRef)

  const initialRect = useMemo(
    () => ({ width: 0, height: typeof window === 'undefined' ? 0 : window.innerHeight }),
    [],
  )

  // `.terminal-column` is itself the scroll element and carries its own padding, so the list's
  // top sits inset from the scroll container's top by that padding - measured, not hardcoded.
  const scrollMargin = useScrollMargin(scrollEl, listRef)

  // Extraction is the expensive part of pricing an entry - cached by id, not redone per estimate.
  const metricsCacheRef = useRef(new Map())
  const metricsFor = useCallback(entry => {
    if (!entry.result) {
      return deriveEntryMetrics(entry)
    }

    const cached = metricsCacheRef.current.get(entry.id)
    if (cached) {
      return cached
    }

    const metrics = deriveEntryMetrics(entry)
    metricsCacheRef.current.set(entry.id, metrics)
    return metrics
  }, [])

  const estimateSize = useCallback(
    index => {
      const entry = entries[index]
      return entry ? predictTerminalEntryHeight(metricsFor(entry)) : 0
    },
    [entries, metricsFor],
  )

  const getItemKey = useCallback(index => entries[index]?.id ?? index, [entries])

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollEl,
    estimateSize,
    getItemKey,
    initialRect,
    scrollMargin,
    overscan: TERMINAL_OVERSCAN,
    // Stay-put and follow-new-entry-at-bottom, from virtual-core rather than a hand-rolled loop.
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: AUTOSCROLL_THRESHOLD,
    measureElement: measureRoundedElement,
  })

  const virtualItems = virtualizer.getVirtualItems()

  return {
    virtualizer,
    virtualItems,
    scrollMargin,
    windowed: entries.length === 0 || virtualItems.length > 0,
  }
}
