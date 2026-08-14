/** Recover container SSE after reconnection attempts exhaust. */

import { useEffect, useRef } from 'react'
import { useContainerMap } from '../../../context/ContainerMapContext'
import { useEvents } from '../../../context/EventsContext'
import { useInteraction } from '../../../context/InteractionContext'
import { useSessionActions } from '../../../context/SessionDataContext'
import { useSessionRouting } from '../../../context/SessionRoutingContext'
import { resumeAndReconnect } from '../utils/sessionResume'

/**
 * When a container restarts (e.g. port change), SSE breaks and SSEConnectionManager's retries exhaust.
 * Unlike daemon-level reconnection (DaemonReconnectEffect), this calls resumeSession() for a fresh ID first.
 */
export default function ContainerRecoveryEffect() {
  const { activeSessionId } = useSessionRouting()
  const {
    containerRecoveryNeeded,
    reconnectSSE,
    disconnectSSE,
    closeSSE,
    startResume,
    clearResume,
    notifyContainerChanged,
  } = useEvents()
  const { setSessionContainer, stoppingSessions } = useContainerMap()
  const { clearSessionData } = useSessionActions()
  const { setError } = useInteraction()

  const prevRecoveryRef = useRef(containerRecoveryNeeded)

  useEffect(() => {
    // Only act on actual increments, not initial render
    if (containerRecoveryNeeded === prevRecoveryRef.current) {
      return
    }
    prevRecoveryRef.current = containerRecoveryNeeded

    if (!activeSessionId) {
      closeSSE()
      return
    }

    // User-initiated stop is terminal - never auto-resurrect a stopped session
    if (stoppingSessions.has(activeSessionId)) {
      return
    }

    resumeAndReconnect({
      activeSessionId,
      startResume,
      reconnectSSE,
      notifyContainerChanged,
      setSessionContainer,
      clearSessionData,
      onError: () => {
        clearResume()
        disconnectSSE()
        setError('Container reconnect failed - waiting for daemon')
      },
    })
  }, [
    containerRecoveryNeeded,
    activeSessionId,
    stoppingSessions,
    disconnectSSE,
    closeSSE,
    startResume,
    clearResume,
    reconnectSSE,
    notifyContainerChanged,
    setSessionContainer,
    clearSessionData,
    setError,
  ])

  return null
}
