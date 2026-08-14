/** Streaming status flags (isResuming, isReplaying, isResponding) with stable identity. */

import { createContext, useContext } from 'react'

export const StreamingStatusContext = createContext(null)

/**
 * Access streaming status flags with stable identity across SSE flushes.
 *
 * Sibling to useEvents() for consumers that only need to know whether the app is resuming,
 * replaying, or streaming a response. The object's identity changes only when one of the three
 * booleans flips, so subscribers don't re-render at flush rate (~20Hz) like useEvents() consumers.
 */
export function useStreamingStatus() {
  const context = useContext(StreamingStatusContext)
  if (!context) {
    throw new Error('useStreamingStatus must be used within EventsProvider')
  }
  return context
}
