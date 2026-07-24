/** Map session IDs to container IDs - eagerly populated at creation/resume time. */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { resolveContainerId } from '../utils/containerLookup'

const ContainerMapContext = createContext(null)

/**
 * Provide an eagerly-populated session->container mapping.
 *
 * SessionTab reads from this map first, falling back to the sessions list
 * for page-reload scenarios where the map hasn't been populated yet.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 */
export function ContainerMapProvider({ children }) {
  const [containerMap, setContainerMap] = useState({})
  const [stoppingSessions, setStoppingSessions] = useState(new Set())

  const setSessionContainer = useCallback((sessionId, containerId) => {
    setContainerMap(prev => ({ ...prev, [sessionId]: containerId }))
  }, [])

  const removeSessionContainer = useCallback(sessionId => {
    setContainerMap(prev => {
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
  }, [])

  const addStoppingSession = useCallback(sessionId => {
    setStoppingSessions(prev => new Set([...prev, sessionId]))
  }, [])

  const removeStoppingSession = useCallback(sessionId => {
    setStoppingSessions(prev => {
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })
  }, [])

  // Single source of truth for a session's container status. Container presence
  // is authoritative: resolve it first (eager map, then the canonical sessions
  // list, then `fallbackContainerId`). A session with no live container is 'none'
  // even if the optimistic `stoppingSessions` set still holds it; 'stopping'
  // applies only while a container is present, so status follows the list. Every
  // status dot (panel, header, bookmarks) routes through this so the surfaces
  // cannot diverge.
  const deriveSessionStatus = useCallback(
    (sessionId, sessions = [], fallbackContainerId = null) => {
      const containerId =
        resolveContainerId(sessionId, containerMap, sessions) ?? fallbackContainerId
      if (!containerId) {
        return 'none'
      }
      return stoppingSessions.has(sessionId) ? 'stopping' : 'running'
    },
    [stoppingSessions, containerMap],
  )

  const value = useMemo(
    () => ({
      containerMap,
      setSessionContainer,
      removeSessionContainer,
      stoppingSessions,
      addStoppingSession,
      removeStoppingSession,
      deriveSessionStatus,
    }),
    [
      containerMap,
      setSessionContainer,
      removeSessionContainer,
      stoppingSessions,
      addStoppingSession,
      removeStoppingSession,
      deriveSessionStatus,
    ],
  )

  return <ContainerMapContext.Provider value={value}>{children}</ContainerMapContext.Provider>
}

/**
 * Access the session->container mapping.
 * @returns {{ containerMap: Record<string, string>, setSessionContainer: Function, removeSessionContainer: Function, stoppingSessions: Set<string>, addStoppingSession: Function, removeStoppingSession: Function, deriveSessionStatus: Function }}
 */
export function useContainerMap() {
  const context = useContext(ContainerMapContext)
  if (!context) {
    throw new Error('useContainerMap must be used within ContainerMapProvider')
  }
  return context
}
