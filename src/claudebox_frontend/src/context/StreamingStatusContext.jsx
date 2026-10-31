/** Streaming status flags and the open/create request lifetimes, with stable identity. */

import { createContext, useContext } from 'react'

export const StreamingStatusContext = createContext(null)

/**
 * Resuming, replaying, responding and the open/create request lifetimes, with an identity that changes
 * only when one of them flips - so subscribers skip useEvents()' flush-rate re-renders.
 */
export function useStreamingStatus() {
  const context = useContext(StreamingStatusContext)
  if (!context) {
    throw new Error('useStreamingStatus must be used within EventsProvider')
  }
  return context
}
