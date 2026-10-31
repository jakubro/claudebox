/** Subscribe to daemon SSE stream for progress, session, container and board events. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchDaemonCommit } from '../api/daemon'
import { DAEMON_STREAM_URL } from '../config/urls'
import { boardChangeKey } from '../utils/boardChanges'
import useSSE from './useSSE'

/**
 * `changesByWorkspace` counts sessions_changed and container_status events per `workspace_id`;
 * `sessionsChanged` counts every sessions_changed; `boardChanges` counts board_update per
 * `boardChangeKey(workspace_id, board_id)`; `daemonReconnected` counts reconnects, not the first.
 * A reconnect to a daemon on another commit than the first connect saw reloads the page instead.
 *
 * @returns {{ progressMessage: string|null, sessionsChanged: number, lastSessionsChangedContainerId: string|null, changesByWorkspace: Record<string, number>, boardChanges: Record<string, number>, lastContainerEvent: object|null, daemonConnected: boolean, daemonReconnected: number }}
 */
export default function useDaemonStream() {
  const [progressMessage, setProgressMessage] = useState(null)
  const [sessionsChanged, setSessionsChanged] = useState(0)
  const [changesByWorkspace, setChangesByWorkspace] = useState({})
  const [boardChanges, setBoardChanges] = useState({})
  const [lastContainerEvent, setLastContainerEvent] = useState(null)
  const [lastSessionsChangedContainerId, setLastSessionsChangedContainerId] = useState(null)
  const [daemonReconnected, setDaemonReconnected] = useState(0)

  // Refs to avoid re-creating the callback on counter changes
  const sessionsRef = useRef(0)
  const reconnectedRef = useRef(0)
  const prevStatusRef = useRef(null)
  const initialConnectionRef = useRef(true)
  const pageCommitRef = useRef(null)

  const onMessage = useCallback(event => {
    const bumpWorkspace = workspaceId =>
      setChangesByWorkspace(prev => ({ ...prev, [workspaceId]: (prev[workspaceId] ?? 0) + 1 }))
    try {
      const data = JSON.parse(event.data)
      if (data.type === 'session_progress') {
        setProgressMessage(data.message)
      } else if (data.type === 'sessions_changed') {
        sessionsRef.current += 1
        setSessionsChanged(sessionsRef.current)
        setLastSessionsChangedContainerId(data.container_id || null)
        bumpWorkspace(data.workspace_id)
      } else if (data.type === 'container_status') {
        setLastContainerEvent({ containerId: data.container_id, status: data.status })
        bumpWorkspace(data.workspace_id)
      } else if (data.type === 'board_update') {
        const key = boardChangeKey(data.workspace_id, data.board_id)
        setBoardChanges(prev => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }))
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
        fetchDaemonCommit().then(commit => {
          pageCommitRef.current = commit
        })
        return
      }
      // Asked before the reconnect is counted, so no session recovery races the reload.
      fetchDaemonCommit().then(commit => {
        if (pageCommitRef.current && commit && commit !== pageCommitRef.current) {
          window.location.reload()
          return
        }
        reconnectedRef.current += 1
        setDaemonReconnected(reconnectedRef.current)
      })
    }
  }, [connectionStatus])

  const clearProgress = useCallback(() => setProgressMessage(null), [])

  return {
    progressMessage,
    clearProgress,
    sessionsChanged,
    lastSessionsChangedContainerId,
    changesByWorkspace,
    boardChanges,
    lastContainerEvent,
    daemonConnected,
    daemonReconnected,
  }
}
