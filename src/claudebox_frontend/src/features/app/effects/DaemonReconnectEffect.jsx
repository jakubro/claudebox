/** Re-resume active session after daemon SSE reconnects. */

import { useEffect, useRef } from 'react'
import { useContainerMap } from '../../../context/ContainerMapContext'
import { useDaemonStreamContext } from '../../../context/DaemonStreamContext'
import { useEvents } from '../../../context/EventsContext'
import { useInteraction } from '../../../context/InteractionContext'
import { useSessionActions } from '../../../context/SessionDataContext'
import { useSessionRouting } from '../../../context/SessionRoutingContext'
import { resumeAndReconnect } from '../utils/sessionResume'

/**
 * Watch daemon SSE reconnection and re-resume the active session.
 *
 * When the daemon restarts, the container SSE proxy dies and reconnect attempts
 * exhaust (containerId becomes null). Once the daemon SSE reconnects, this effect
 * calls the resume endpoint to get a fresh container ID and reconnects the
 * container SSE. Skips if the container SSE survived the daemon restart.
 *
 * Renders nothing — exists solely for daemon reconnection recovery.
 */
export default function DaemonReconnectEffect() {
  const { daemonReconnected } = useDaemonStreamContext()
  const { activeSessionId } = useSessionRouting()
  const {
    reconnectSSE,
    startResume,
    clearResume,
    notifyContainerChanged,
    containerId,
    isConnected,
  } = useEvents()
  const { setSessionContainer } = useContainerMap()
  const { clearSessionData } = useSessionActions()
  const { setError } = useInteraction()

  const prevReconnectedRef = useRef(daemonReconnected)

  useEffect(() => {
    // Only act on actual increments, not initial render
    if (daemonReconnected === prevReconnectedRef.current) {
      return
    }
    prevReconnectedRef.current = daemonReconnected

    // No active session to re-resume
    if (!activeSessionId) {
      return
    }

    // Container SSE survived the daemon restart — skip redundant resume
    if (containerId && isConnected) {
      return
    }

    // Re-resume: get fresh container ID from daemon
    clearResume()
    resumeAndReconnect({
      activeSessionId,
      startResume,
      reconnectSSE,
      notifyContainerChanged,
      setSessionContainer,
      clearSessionData,
      onError: () => {
        clearResume()
        setError('Session reconnect failed')
      },
    })
  }, [
    daemonReconnected,
    activeSessionId,
    containerId,
    isConnected,
    clearResume,
    startResume,
    reconnectSSE,
    notifyContainerChanged,
    setSessionContainer,
    clearSessionData,
    setError,
  ])

  return null
}
