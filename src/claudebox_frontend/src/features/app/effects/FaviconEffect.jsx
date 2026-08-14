/** App-level favicon dispatcher - workspace badge persists across every route. */

import { useEvents } from '../../../context/EventsContext'
import { useInteraction } from '../../../context/InteractionContext'
import useFavicon from '../../chat/hooks/useFavicon'

/**
 * Composite `isResponding` from EventsContext + InteractionContext, both tracking the active session;
 * when none is active (board route, welcome state) it naturally reads false, showing the normal favicon.
 */
export default function FaviconEffect() {
  const { isResponding } = useEvents()
  const { isSubmitting, isAwaitingResponse } = useInteraction()
  useFavicon({ isResponding: isSubmitting || isAwaitingResponse || isResponding })
  return null
}
