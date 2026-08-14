/** Gracefully disconnect SSE when the active container stops. */

import { useEffect } from 'react'
import { useContainerMap } from '../../../context/ContainerMapContext'
import { useEvents } from '../../../context/EventsContext'
import { useSessionActions } from '../../../context/SessionDataContext'
import { useSessionsList } from '../../../context/SessionsContext'
import { resolveSessionIdFromContainer } from '../../../utils/containerLookup'

/**
 * Prevents the error cascade ("Session load failed", "Connection lost") when a container is intentionally stopped.
 * Alive-ness comes from two sources: the sessions list (refreshed on daemon container_status events) and
 * containerMap (populated eagerly by useNewSession on creation); the list alone lags newly-created sessions
 * for seconds since the daemon doesn't emit sessions_changed for container-level creation.
 */
export default function ContainerStopEffect() {
  const { sessions } = useSessionsList()
  const { containerMap } = useContainerMap()
  const { containerId, disconnectSSE, isConnected, isCreating, isResuming } = useEvents()
  const { clearSessionData } = useSessionActions()

  useEffect(() => {
    if (!(containerId && isConnected)) {
      return
    }

    // Sessions list is stale during creation/resume - skip container-alive check
    if (isCreating || isResuming) {
      return
    }

    // Sessions not yet loaded - skip until first real fetch completes
    if (sessions.length === 0) {
      return
    }

    // Either source resolving the container to a session means it's alive.
    if (!resolveSessionIdFromContainer(containerId, containerMap, sessions)) {
      disconnectSSE()
      clearSessionData()
    }
  }, [
    containerId,
    isConnected,
    isCreating,
    isResuming,
    sessions,
    containerMap,
    disconnectSSE,
    clearSessionData,
  ])

  return null
}
