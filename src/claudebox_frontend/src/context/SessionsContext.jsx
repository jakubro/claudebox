/** Sessions list context with SSE-driven refresh. */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { listSessions } from '../api/sessions'
import { getUiState, patchGlobalUiState } from '../api/uiState'
import { PINNED_PATH, WORKSPACE_COLOR_PATH } from '../config/storage'
import { SESSIONS_CHANGED_DEBOUNCE_MS } from '../config/timing'
import { useDaemonStreamContext } from './DaemonStreamContext'
import { useWorkspace } from './WorkspaceContext'

const SessionsContext = createContext(null)

/**
 * Provide preloaded sessions list with SSE-driven refresh.
 *
 * Refetches when the daemon broadcasts sessions_changed or container_status
 * events, replacing the previous 30s polling interval.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - Child components.
 */
export function SessionsProvider({ children }) {
  const { workspaceId } = useWorkspace()
  const { sessionsChanged, containerStatus } = useDaemonStreamContext()
  const [sessions, setSessions] = useState([])
  const [pinnedSessions, setPinnedSessions] = useState([])
  const [workspaceColor, setWorkspaceColorState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)

  const fetchSessions = useCallback(async () => {
    if (!workspaceId) {
      return
    }
    try {
      const [sessionsData, uiStateData] = await Promise.all([listSessions(), getUiState()])
      setSessions(sessionsData.sessions || [])
      setPinnedSessions(uiStateData.global?.pinnedSessions || [])
      setWorkspaceColorState(uiStateData.global?.workspaceColor || null)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  // Fetch when workspace becomes available
  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  // Refetch when daemon signals sessions or container changes (debounced to collapse rapid events)
  useEffect(() => {
    if (sessionsChanged > 0 || containerStatus > 0) {
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(fetchSessions, SESSIONS_CHANGED_DEBOUNCE_MS)
    }
    return () => clearTimeout(debounceRef.current)
  }, [sessionsChanged, containerStatus, fetchSessions])

  // Set workspace accent color with optimistic update — fire-and-forget
  const setWorkspaceColor = useCallback(color => {
    setWorkspaceColorState(color)
    if (color) {
      patchGlobalUiState([{ op: 'set', path: WORKSPACE_COLOR_PATH, value: color }])
    } else {
      patchGlobalUiState([{ op: 'unset', path: WORKSPACE_COLOR_PATH }])
    }
  }, [])

  // Optimistic insert/update — used by fork to populate the panel before the
  // sessions_changed SSE refresh lands. Replaces by session_id if present.
  const seedSession = useCallback(info => {
    if (!info?.session_id) {
      return
    }
    setSessions(prev => {
      const idx = prev.findIndex(s => s.session_id === info.session_id)
      if (idx >= 0) {
        const next = prev.slice()
        next[idx] = { ...next[idx], ...info }
        return next
      }
      return [...prev, info]
    })
  }, [])

  // Toggle pin with optimistic update — fire-and-forget, no read needed
  const togglePin = useCallback(sessionId => {
    setPinnedSessions(prev => {
      const isPinned = prev.includes(sessionId)
      if (isPinned) {
        patchGlobalUiState([{ op: 'remove', path: PINNED_PATH, value: sessionId }])
        return prev.filter(id => id !== sessionId)
      }
      patchGlobalUiState([{ op: 'add', path: PINNED_PATH, value: sessionId }])
      return [...prev, sessionId]
    })
  }, [])

  const value = useMemo(
    () => ({
      sessions,
      pinnedSessions,
      workspaceColor,
      loading,
      error,
      refresh: fetchSessions,
      togglePin,
      setWorkspaceColor,
      seedSession,
    }),
    [
      sessions,
      pinnedSessions,
      workspaceColor,
      loading,
      error,
      fetchSessions,
      togglePin,
      setWorkspaceColor,
      seedSession,
    ],
  )

  return <SessionsContext.Provider value={value}>{children}</SessionsContext.Provider>
}

/** Access preloaded sessions list and pin operations. */
export function useSessionsList() {
  const context = useContext(SessionsContext)
  if (!context) {
    throw new Error('useSessionsList must be used within SessionsProvider')
  }
  return context
}
