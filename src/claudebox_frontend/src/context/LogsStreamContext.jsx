/** Provider-scoped logs SSE stream - persists across panel toggle. */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { getWorkspaceId } from '../api/apiClient'
import { EventSubtype, EventType } from '../config/schema'
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
  // audit-ignore: session-transition-guard - the log stream follows the container by design
  const prevContainerIdRef = useRef(containerId)
  // Lines between the replay boundaries, applied together when the replay ends; null outside one.
  const replayBufferRef = useRef(null)

  if (containerId !== prevContainerIdRef.current) {
    prevContainerIdRef.current = containerId
    replayBufferRef.current = null
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
    const append = lines => {
      if (lines.some(line => line.level === 'ERROR' || line.level === 'CRITICAL')) {
        setHasUnreadErrors(true)
      }
      setLogs(prev => [...prev, ...lines].slice(-MAX_LOGS))
    }

    // A reconnect's replay starts afresh, dropping whatever a dropped stream had buffered.
    if (data.type === EventType.SYSTEM) {
      if (data.subtype === EventSubtype.REPLAY_STARTED) {
        replayBufferRef.current = []
      } else if (data.subtype === EventSubtype.REPLAY_ENDED && replayBufferRef.current) {
        append(replayBufferRef.current)
        replayBufferRef.current = null
      }
      return
    }

    if (replayBufferRef.current) {
      replayBufferRef.current.push(data)
    } else {
      append([data])
    }
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
