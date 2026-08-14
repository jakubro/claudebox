/** Provider-scoped logs SSE stream - persists across panel toggle. */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { getWorkspaceId } from '../api/apiClient'
import { EventType } from '../config/schema'
import { MAX_LOGS } from '../config/thresholds'
import useSSE from '../hooks/useSSE'
import { useEvents } from './EventsContext'

const LogsStreamContext = createContext(null)

/**
 * Lifts the logs EventSource from component scope (LogsPanel) to provider scope - avoids
 * reconnect churn on panel toggle and HTTP/1.1 connection-slot exhaustion from overlapping
 * instances.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 */
export function LogsStreamProvider({ children }) {
  const { isResuming, isReplaying: isSessionReplaying, containerId } = useEvents()
  const [logs, setLogs] = useState([])
  const [hasUnreadErrors, setHasUnreadErrors] = useState(false)
  const prevContainerIdRef = useRef(containerId)

  if (containerId !== prevContainerIdRef.current) {
    prevContainerIdRef.current = containerId
    setLogs([])
    setHasUnreadErrors(false)
  }

  const clearUnreadErrors = useCallback(() => {
    setHasUnreadErrors(false)
  }, [])

  const logsUrl = useMemo(() => {
    if (!containerId) {
      return null
    }
    const wsId = getWorkspaceId()
    if (!wsId) {
      return null
    }
    return `/api/workspaces/${wsId}/containers/${containerId}/api/logs`
  }, [containerId])

  const onMessage = useCallback(event => {
    const data = JSON.parse(event.data)

    // Boundary frames delimit history for consumers that need it; the panel streams through
    // without surfacing a transition.
    if (data.type === EventType.SYSTEM) {
      return
    }

    if (data.level === 'ERROR' || data.level === 'CRITICAL') {
      setHasUnreadErrors(true)
    }

    setLogs(prev => [...prev, data].slice(-MAX_LOGS))
  }, [])

  const { connectionStatus } = useSSE({ onMessage, url: logsUrl })

  const value = useMemo(
    () => ({
      logs,
      connectionStatus,
      isResuming,
      isSessionReplaying,
      containerId,
      hasUnreadErrors,
      clearUnreadErrors,
    }),
    [
      logs,
      connectionStatus,
      isResuming,
      isSessionReplaying,
      containerId,
      hasUnreadErrors,
      clearUnreadErrors,
    ],
  )

  return <LogsStreamContext.Provider value={value}>{children}</LogsStreamContext.Provider>
}

/**
 * Access logs SSE stream data.
 * @returns {{ logs: Array, connectionStatus: string, isResuming: boolean, isSessionReplaying: boolean, containerId: string|null }}
 */
export function useLogsStream() {
  const context = useContext(LogsStreamContext)
  if (!context) {
    throw new Error('useLogsStream must be used within LogsStreamProvider')
  }
  return context
}
