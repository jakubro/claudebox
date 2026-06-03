/** Provider-scoped logs SSE stream — persists across panel toggle. */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { getWorkspaceId } from '../api/apiClient'
import { EventSubtype, EventType } from '../config/schema'
import { MAX_LOGS } from '../config/thresholds'
import useSSE from '../hooks/useSSE'
import { useEvents } from './EventsContext'

const LogsStreamContext = createContext(null)

/**
 * Provide a single logs SSE connection shared across panel mount/unmount cycles.
 *
 * Lifts the logs EventSource from component scope (LogsPanel) to provider scope,
 * preventing reconnection churn when the panel is toggled and avoiding HTTP/1.1
 * connection slot exhaustion from overlapping EventSource instances.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - Child components.
 */
export function LogsStreamProvider({ children }) {
  const { isResuming, isReplaying: isSessionReplaying, containerId } = useEvents()
  const [logs, setLogs] = useState([])
  const [isLogsReplaying, setIsLogsReplaying] = useState(false)
  const [hasUnreadErrors, setHasUnreadErrors] = useState(false)
  const prevContainerIdRef = useRef(containerId)

  // Clear logs when container changes
  if (containerId !== prevContainerIdRef.current) {
    prevContainerIdRef.current = containerId
    setLogs([])
    setIsLogsReplaying(false)
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

    if (data.type === EventType.SYSTEM) {
      if (data.subtype === EventSubtype.REPLAY_STARTED) {
        setIsLogsReplaying(true)
      } else if (data.subtype === EventSubtype.REPLAY_ENDED) {
        setIsLogsReplaying(false)
      }
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
      isLogsReplaying,
      connectionStatus,
      isResuming,
      isSessionReplaying,
      containerId,
      hasUnreadErrors,
      clearUnreadErrors,
    }),
    [
      logs,
      isLogsReplaying,
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
 * @returns {{ logs: Array, isLogsReplaying: boolean, connectionStatus: string, isResuming: boolean, isSessionReplaying: boolean, containerId: string|null }}
 */
export function useLogsStream() {
  const context = useContext(LogsStreamContext)
  if (!context) {
    throw new Error('useLogsStream must be used within LogsStreamProvider')
  }
  return context
}
