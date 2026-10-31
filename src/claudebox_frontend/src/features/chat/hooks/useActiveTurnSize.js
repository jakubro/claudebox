/** Publish the live turn's rendered size, which the windowed list never measures. */

import { useLayoutEffect } from 'react'

/**
 * Observe the active turn's element and write its height, bottom margin included to match a
 * windowed row, into `rowSizes` under `turnId`. `turnIndex` re-attaches when the turn remounts.
 */
export default function useActiveTurnSize(messagesRef, turnId, turnIndex, rowSizes) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: turnIndex is part of the live turn's key
  useLayoutEffect(() => {
    const el = turnId
      ? messagesRef.current?.querySelector(`.turn-container[data-turn-id="${turnId}"]`)
      : null
    if (!el) {
      return undefined
    }

    const publish = () => {
      const height = el.getBoundingClientRect().height
      if (height > 0) {
        const margin = parseFloat(getComputedStyle(el).marginBottom) || 0
        rowSizes.set(turnId, Math.round(height + margin))
      }
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(el)

    return () => observer.disconnect()
  }, [messagesRef, turnId, turnIndex, rowSizes])
}
