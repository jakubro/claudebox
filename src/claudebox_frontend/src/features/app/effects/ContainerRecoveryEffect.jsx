/** Recover container SSE after reconnection attempts exhaust. */

import { useEffect, useRef } from 'react'
import { useContainerMap } from '../../../context/ContainerMapContext'
import { useEvents } from '../../../context/EventsContext'
import { useInteraction } from '../../../context/InteractionContext'
import { useSessionActions } from '../../../context/SessionDataContext'
import { useSessionRouting } from '../../../context/SessionRoutingContext'
import { resumeAndReconnect } from '../utils/sessionResume'

/**
 * Attempt session resume when container SSE reconnection is exhausted.
 *
 * When a container restarts (e.g., port change), the SSE stream breaks and
 * SSEConnectionManager retries exhaust. Unlike daemon-level reconnection
 * (handled by DaemonReconnectEffect), this handles container-level disconnection
 * by calling resumeSession() to get a fresh container ID before giving up.
 *
 * Renders nothing - exists solely for container-level recovery.
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

    // No active session to recover
    if (!activeSessionId) {
      closeSSE()
      return
    }

    // User-initiated stop is terminal - never auto-resurrect a stopped session
    if (stoppingSessions.has(activeSessionId)) {
      return
    }

    // Attempt resume to get a fresh container ID
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
