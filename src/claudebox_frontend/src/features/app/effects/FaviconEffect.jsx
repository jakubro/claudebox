/** App-level favicon dispatcher — workspace badge persists across every route. */

import { useEvents } from '../../../context/EventsContext'
import { useInteraction } from '../../../context/InteractionContext'
import useFavicon from '../../chat/hooks/useFavicon'

/**
 * Drive the dynamic favicon from app level so the workspace badge renders on
 * every route, not just the session route. Composite `isResponding` sources
 * from EventsContext + InteractionContext, both tracking the active session;
 * when no session is active (board route, welcome state) the composite
 * naturally reads false and the hook renders the normal favicon state.
 */
export default function FaviconEffect() {
  const { isResponding } = useEvents()
  const { isSubmitting, isAwaitingResponse } = useInteraction()
  useFavicon({ isResponding: isSubmitting || isAwaitingResponse || isResponding })
  return null
}
