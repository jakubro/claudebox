/** Gracefully disconnect SSE when the active container stops. */

import { useEffect } from 'react'
import { useContainerMap } from '../../../context/ContainerMapContext'
import { useEvents } from '../../../context/EventsContext'
import { useSessionActions } from '../../../context/SessionDataContext'
import { useSessionsList } from '../../../context/SessionsContext'
import { resolveSessionIdFromContainer } from '../../../utils/containerLookup'

/**
 * Watch for the active container disappearing and gracefully disconnect SSE
 * before the TCP connection drops.
 *
 * Prevents the error cascade ("Session load failed", "Connection lost") that
 * occurs when a container is intentionally stopped. Uses two sources to decide
 * whether the container is alive:
 * - sessions list (refreshed on daemon container_status events)
 * - containerMap (populated eagerly by useNewSession on creation)
 *
 * The sessions list alone is unreliable: newly-created sessions may not appear
 * in it for seconds (daemon doesn't emit sessions_changed for container-level
 * session creation). containerMap closes that gap.
 *
 * Renders nothing - exists solely to coordinate context transitions.
 */
export default function ContainerStopEffect() {
  const { sessions } = useSessionsList()
  const { containerMap } = useContainerMap()
  const { containerId, disconnectSSE, isConnected, isCreating, isResuming } = useEvents()
  const { clearSessionData } = useSessionActions()

  useEffect(() => {
    // No active container - nothing to disconnect
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

    // Active container is alive if either source resolves it to a session.
    // containerMap is populated eagerly by useNewSession - reliable for
    // recently-created containers that haven't appeared in sessions yet.
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
