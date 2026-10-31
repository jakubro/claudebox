/** App-level favicon dispatcher - workspace badge persists across every route. */

import { useEvents } from '../../../context/EventsContext'
import { useInteraction } from '../../../context/InteractionContext'
import { useSessionData } from '../../../context/SessionDataContext'
import { useSessionRouting } from '../../../context/SessionRoutingContext'
import useBackgroundWaiting from '../../../hooks/useBackgroundWaiting'
import useFavicon from '../../chat/hooks/useFavicon'

/**
 * Composite `isResponding` from EventsContext + InteractionContext, both tracking the active session;
 * when none is active (board route, welcome state) it naturally reads false, showing the normal favicon.
 */
export default function FaviconEffect() {
  const { isResponding } = useEvents()
  const { isSubmitting, isAwaitingResponse } = useInteraction()
  const { sessionData } = useSessionData()
  const { activeSessionId } = useSessionRouting()
  const { isWaiting, awaitingPickup } = useBackgroundWaiting()
  useFavicon({
    isResponding: isSubmitting || isAwaitingResponse || isResponding || awaitingPickup,
    isWaiting,
    // Gated on the id: a switch keeps the previous session's data until the new one resolves.
    needsUser: Boolean(sessionData?.needs_user) && sessionData?.session_id === activeSessionId,
  })
  return null
}
