/** Streaming status flags (isResuming, isReplaying, isResponding) with stable identity. */

import { createContext, useContext } from 'react'

export const StreamingStatusContext = createContext(null)

/**
 * Access streaming status flags with stable identity across SSE flushes.
 *
 * Sibling to useEvents() for consumers that only need to know whether the
 * app is currently resuming, replaying, or actively streaming a response.
 * The provided object's identity changes only when one of the three
 * booleans flips, so subscribed components do not re-render at flush rate
 * (~20Hz) the way useEvents() consumers do.
 */
export function useStreamingStatus() {
  const context = useContext(StreamingStatusContext)
  if (!context) {
    throw new Error('useStreamingStatus must be used within EventsProvider')
  }
  return context
}
