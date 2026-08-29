/** Sync stopping state from daemon SSE container_status events. */

import { useEffect, useRef } from 'react'
import { useContainerMap } from '../../../context/ContainerMapContext'
import { useDaemonStreamContext } from '../../../context/DaemonStreamContext'
import { useSessionsList } from '../../../context/SessionsContext'
import { resolveSessionIdFromContainer } from '../../../utils/containerLookup'

/**
 * On "stopping": resolve containerId -> sessionId, cache it, and mark as stopping. On "stopped":
 * use the cached mapping (avoids a race with the sessions refetch), then clear stopping/mapping.
 */
export default function ContainerStatusEffect() {
  const { lastContainerEvent } = useDaemonStreamContext()
  const {
    containerMap,
    addStoppingSession,
    removeStoppingSession,
    removeSessionContainer,
    stoppingSessions,
  } = useContainerMap()
  const { sessions } = useSessionsList()

  // Cache containerId -> sessionId from "stopping" events so "stopped" lookups survive the sessions
  // refetch race (backend clears container_id before broadcasting "stopped").
  const stoppingCacheRef = useRef(new Map())

  useEffect(() => {
    if (!lastContainerEvent) {
      return
    }

    const { containerId, status } = lastContainerEvent

    if (status === 'stopping') {
      const sessionId = resolveSessionIdFromContainer(containerId, containerMap, sessions)

      if (sessionId) {
        stoppingCacheRef.current.set(containerId, sessionId)
        addStoppingSession(sessionId)
      }
    } else if (status === 'stopped') {
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

  // Self-heal from the authoritative sessions list: when a stopping session shows no live container,
  // drop the transient stopping hint and stale eager mapping so status settles to gray - covers
  // cases the SSE "stopped" handler above can miss.
  useEffect(() => {
    if (stoppingSessions.size === 0) {
      return
    }
    for (const sessionId of stoppingSessions) {
      const session = sessions.find(s => s.session_id === sessionId)
      if (!session?.container_id) {
        removeStoppingSession(sessionId)
        removeSessionContainer(sessionId)
      }
    }
  }, [sessions, stoppingSessions, removeStoppingSession, removeSessionContainer])

  // A side thread emits no container-level stop event - only its registry entry goes - so neither
  // reconciliation above reaches its mapping. Drop it once the live set no longer reports it.
  useEffect(() => {
    for (const session of sessions) {
      if (session.is_side_thread && containerMap[session.session_id] && !session.container_id) {
        removeSessionContainer(session.session_id)
      }
    }
  }, [sessions, containerMap, removeSessionContainer])

  return null
}
