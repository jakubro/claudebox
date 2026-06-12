/** Shared daemon SSE stream - single connection for all consumers. */

import { createContext, useContext, useMemo } from 'react'
import useDaemonStream from '../hooks/useDaemonStream'

const DaemonStreamContext = createContext(null)

/**
 * Provide a single daemon SSE connection shared by all consumers.
 *
 * Wraps useDaemonStream so only one EventSource connects to /api/daemon/stream,
 * regardless of how many components consume the stream data.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - Child components.
 */
export function DaemonStreamProvider({ children }) {
  const {
    progressMessage,
    clearProgress,
    sessionsChanged,
    lastSessionsChangedContainerId,
    containerStatus,
    lastContainerEvent,
    daemonConnected,
    daemonReconnected,
  } = useDaemonStream()

  const value = useMemo(
    () => ({
      progressMessage,
      clearProgress,
      sessionsChanged,
      lastSessionsChangedContainerId,
      containerStatus,
      lastContainerEvent,
      daemonConnected,
      daemonReconnected,
    }),
    [
      progressMessage,
      clearProgress,
      sessionsChanged,
      lastSessionsChangedContainerId,
      containerStatus,
      lastContainerEvent,
      daemonConnected,
      daemonReconnected,
    ],
  )

  return <DaemonStreamContext.Provider value={value}>{children}</DaemonStreamContext.Provider>
}

/**
 * Access daemon SSE stream signals.
 * @returns {{ progressMessage: string|null, sessionsChanged: number, lastSessionsChangedContainerId: string|null, containerStatus: number, lastContainerEvent: {containerId: string, status: string}|null, daemonConnected: boolean, daemonReconnected: number }}
 */
export function useDaemonStreamContext() {
  const context = useContext(DaemonStreamContext)
  if (!context) {
    throw new Error('useDaemonStreamContext must be used within DaemonStreamProvider')
  }
  return context
}
