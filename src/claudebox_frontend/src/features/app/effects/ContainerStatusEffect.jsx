/** Sync stopping state from daemon SSE container_status events. */

import { useEffect, useRef } from 'react'
import { useContainerMap } from '../../../context/ContainerMapContext'
import { useDaemonStreamContext } from '../../../context/DaemonStreamContext'
import { useSessionsList } from '../../../context/SessionsContext'
import { resolveSessionIdFromContainer } from '../../../utils/containerLookup'

/**
 * React to daemon container_status events to maintain the stopping sessions set.
 *
 * On "stopping": resolve containerId -> sessionId, cache the mapping, and mark as stopping.
 * On "stopped": use cached mapping (avoids race with sessions refetch), remove from stopping
 * set and clean up container mapping.
 *
 * Renders nothing - exists solely for cross-tab stopping state coordination.
 */
export default function ContainerStatusEffect() {
  const { lastContainerEvent } = useDaemonStreamContext()
  const { containerMap, addStoppingSession, removeStoppingSession, removeSessionContainer } =
    useContainerMap()
  const { sessions } = useSessionsList()

  // Cache containerId -> sessionId from "stopping" events so "stopped" lookups
  // survive the sessions refetch race (backend clears container_id before broadcasting "stopped")
  const stoppingCacheRef = useRef(new Map())

  useEffect(() => {
    if (!lastContainerEvent) {
      return
    }

    const { containerId, status } = lastContainerEvent

    if (status === 'stopping') {
      // Resolve containerId -> sessionId and cache for the subsequent "stopped" event
      const sessionId = resolveSessionIdFromContainer(containerId, containerMap, sessions)

      if (sessionId) {
        stoppingCacheRef.current.set(containerId, sessionId)
        addStoppingSession(sessionId)
      }
    } else if (status === 'stopped') {
      // Use cached mapping first - the live sources may already be stale
      const sessionId =
        stoppingCacheRef.current.get(containerId) ??
        resolveSessionIdFromContainer(containerId, containerMap, sessions)

      if (sessionId) {
        stoppingCacheRef.current.delete(containerId)
        removeStoppingSession(sessionId)
        removeSessionContainer(sessionId)
      }
    }
  }, [
    lastContainerEvent,
    containerMap,
    sessions,
    addStoppingSession,
    removeStoppingSession,
    removeSessionContainer,
  ])

  return null
}
