/** Subscribe to daemon SSE stream for progress, session, and container events. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { DAEMON_STREAM_URL } from '../config/urls'
import useSSE from './useSSE'

/**
 * `sessionsChanged`/`containerStatus` are monotonic counters bumped per event, so consumers can
 * use them as effect deps to trigger refetches without the payload. `daemonReconnected` bumps on
 * each disconnected -> connected transition, excluding the initial connect.
 *
 * @returns {{ progressMessage: string|null, sessionsChanged: number, lastSessionsChangedContainerId: string|null, containerStatus: number, lastContainerEvent: object|null, daemonConnected: boolean, daemonReconnected: number }}
 */
export default function useDaemonStream() {
  const [progressMessage, setProgressMessage] = useState(null)
  const [sessionsChanged, setSessionsChanged] = useState(0)
  const [containerStatus, setContainerStatus] = useState(0)
  const [lastContainerEvent, setLastContainerEvent] = useState(null)
  const [lastSessionsChangedContainerId, setLastSessionsChangedContainerId] = useState(null)
  const [daemonReconnected, setDaemonReconnected] = useState(0)

  // Refs to avoid re-creating the callback on counter changes
  const sessionsRef = useRef(0)
  const containerRef = useRef(0)
  const reconnectedRef = useRef(0)
  const prevStatusRef = useRef(null)
  const initialConnectionRef = useRef(true)

  const onMessage = useCallback(event => {
    try {
      const data = JSON.parse(event.data)
      if (data.type === 'session_progress') {
        setProgressMessage(data.message)
      } else if (data.type === 'sessions_changed') {
        sessionsRef.current += 1
        setSessionsChanged(sessionsRef.current)
        setLastSessionsChangedContainerId(data.container_id || null)
      } else if (data.type === 'container_status') {
        setLastContainerEvent({ containerId: data.container_id, status: data.status })
        containerRef.current += 1
        setContainerStatus(containerRef.current)
      }
    } catch {
      // Ignore malformed events
    }
  }, [])

  const { connectionStatus } = useSSE({ onMessage, url: DAEMON_STREAM_URL })

  const daemonConnected = connectionStatus === 'connected'

  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = connectionStatus

    if (connectionStatus === 'connected' && prev && prev !== 'connected') {
      if (initialConnectionRef.current) {
        initialConnectionRef.current = false
        return
      }
      reconnectedRef.current += 1
      setDaemonReconnected(reconnectedRef.current)
    }
  }, [connectionStatus])

  const clearProgress = useCallback(() => setProgressMessage(null), [])

  return {
    progressMessage,
    clearProgress,
    sessionsChanged,
    lastSessionsChangedContainerId,
    containerStatus,
    lastContainerEvent,
    daemonConnected,
    daemonReconnected,
  }
}
