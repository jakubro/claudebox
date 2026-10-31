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
 * When the daemon restarts, the container SSE proxy dies and reconnect attempts exhaust (containerId
 * becomes null); once daemon SSE reconnects, this calls the resume endpoint for a fresh container ID
 * and reconnects, skipping if the container SSE survived the daemon restart.
 */
export default function DaemonReconnectEffect() {
  const { daemonReconnected } = useDaemonStreamContext()
  const { activeSessionId } = useSessionRouting()
  const {
    reconnectSSE,
    startResume,
    settleResumeRequest,
    clearResume,
    getPendingRequests,
    notifyAddressChanged,
    containerId,
    isConnected,
  } = useEvents()
  const { setSessionContainer, stoppingSessions } = useContainerMap()
  const { clearSessionData } = useSessionActions()
  const { setError } = useInteraction()

  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId

  const prevReconnectedRef = useRef(daemonReconnected)

  useEffect(() => {
    // Only act on actual increments, not initial render
    if (daemonReconnected === prevReconnectedRef.current) {
      return
    }
    prevReconnectedRef.current = daemonReconnected

    if (!activeSessionId) {
      return
    }

    // User-initiated stop is terminal - never auto-resurrect a stopped session
    if (stoppingSessions.has(activeSessionId)) {
      return
    }

    if (containerId && isConnected) {
      return
    }

    // An open or create in flight attaches its own container; resuming here would overwrite it.
    const pending = getPendingRequests()
    if (pending.resume !== null || pending.create !== null) {
      return
    }

    resumeAndReconnect({
      activeSessionId,
      isStillActive: () => activeSessionIdRef.current === activeSessionId,
      startResume,
      settleResumeRequest,
      reconnectSSE,
      notifyAddressChanged,
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
    stoppingSessions,
    containerId,
    isConnected,
    clearResume,
    startResume,
    settleResumeRequest,
    getPendingRequests,
    reconnectSSE,
    notifyAddressChanged,
    setSessionContainer,
    clearSessionData,
    setError,
  ])

  return null
}
