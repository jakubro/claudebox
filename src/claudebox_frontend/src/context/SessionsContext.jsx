/** Sessions list context with SSE-driven refresh. */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { listSessions } from '../api/sessions'
import { getUiState, patchGlobalUiState } from '../api/uiState'
import { PINNED_PATH, PINS_CHANGE_SIGNAL_KEY, WORKSPACE_COLOR_PATH } from '../config/storage'
import {
  SESSION_STORAGE_SWEEP_INTERVAL_MS,
  SESSIONS_CHANGED_DEBOUNCE_MS,
  SESSIONS_REFRESH_FALLBACK_MS,
} from '../config/timing'
import {
  collectLiveSessionIdsAcrossWorkspaces,
  sweepDeadSessionStorage,
} from '../utils/sessionStorageGc'
import { useDaemonStreamContext } from './DaemonStreamContext'
import { useWorkspace } from './WorkspaceContext'

const SessionsContext = createContext(null)

/**
 * Refetches when the daemon signals sessions_changed or container_status.
 * A low-frequency fallback poll guarantees the list still converges if a daemon signal is missed or dropped.
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
  // Coalesces concurrent callers (provider mount, panel mount, StrictMode repeat) onto one request.
  const fetchInFlightRef = useRef(null)
  // The workspace the in-flight request was made for - a switch mid-flight must not silently
  // apply the old workspace's response to the new one, so a mismatch bypasses the join below.
  const fetchInFlightWorkspaceRef = useRef(null)
  const lastFetchCompletedAtRef = useRef(0)
  // A signal arriving mid-flight may predate that fetch's snapshot - re-fetch on settle rather than
  // lose it until the fallback poll. Armed only by external-signal callers (SSE, cross-tab sync).
  const pendingSignalRef = useRef(false)
  const sweepLastRunAtRef = useRef(0)

  const fetchSessions = useCallback(
    async ({ armPendingOnJoin = false } = {}) => {
      if (!workspaceId) {
        return
      }
      if (fetchInFlightRef.current && fetchInFlightWorkspaceRef.current === workspaceId) {
        if (armPendingOnJoin) {
          pendingSignalRef.current = true
        }
        return fetchInFlightRef.current
      }

      const run = (async () => {
        try {
          const [sessionsData, uiStateData] = await Promise.all([listSessions(), getUiState()])
          const liveSessions = sessionsData.sessions || []
          setSessions(liveSessions)
          setPinnedSessions(uiStateData.global?.pinnedSessions || [])
          setWorkspaceColorState(uiStateData.global?.workspaceColor || null)
          setError(null)

          const now = Date.now()
          if (now - sweepLastRunAtRef.current >= SESSION_STORAGE_SWEEP_INTERVAL_MS) {
            sweepLastRunAtRef.current = now
            // Keys are workspace-agnostic - a session live elsewhere counts, or refresh deletes it.
            const liveAcrossWorkspaces = await collectLiveSessionIdsAcrossWorkspaces(
              workspaceId,
              liveSessions.map(s => s.session_id),
            )
            sweepDeadSessionStorage(liveAcrossWorkspaces)
          }
        } catch (err) {
          setError(err.message)
        } finally {
          setLoading(false)
          fetchInFlightRef.current = null
          fetchInFlightWorkspaceRef.current = null
          lastFetchCompletedAtRef.current = Date.now()
          if (pendingSignalRef.current) {
            pendingSignalRef.current = false
            fetchSessions()
          }
        }
      })()

      fetchInFlightRef.current = run
      fetchInFlightWorkspaceRef.current = workspaceId
      return run
    },
    [workspaceId],
  )

  // Fetch when workspace becomes available
  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  // Refetch when daemon signals sessions or container changes (debounced to collapse rapid events).
  // The post-fetch cooldown below is scoped to this signal path - inside `refresh` it would
  // silently no-op Retry buttons and cross-tab pin sync, which fire right after a completed fetch.
  useEffect(() => {
    if (sessionsChanged > 0 || containerStatus > 0) {
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        if (fetchInFlightRef.current) {
          pendingSignalRef.current = true
          return
        }
        if (Date.now() - lastFetchCompletedAtRef.current < SESSIONS_CHANGED_DEBOUNCE_MS) {
          return
        }
        fetchSessions()
      }, SESSIONS_CHANGED_DEBOUNCE_MS)
    }
    return () => clearTimeout(debounceRef.current)
  }, [sessionsChanged, containerStatus, fetchSessions])

  // Defense-in-depth: a dropped or missed daemon signal would strand the list without this poll.
  useEffect(() => {
    const interval = setInterval(fetchSessions, SESSIONS_REFRESH_FALLBACK_MS)

    return () => clearInterval(interval)
  }, [fetchSessions])

  // Cross-tab pin sync mirrors useBookmarks: pins are optimistic UI-state with no daemon SSE signal.
  // Another tab writes PINS_CHANGE_SIGNAL_KEY on toggle; this listener refetches ui-state to pick it up.
  useEffect(() => {
    const handleStorage = e => {
      if (e.key === PINS_CHANGE_SIGNAL_KEY) {
        fetchSessions({ armPendingOnJoin: true })
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [fetchSessions])

  // Set workspace accent color with optimistic update - fire-and-forget
  const setWorkspaceColor = useCallback(color => {
    setWorkspaceColorState(color)
    if (color) {
      patchGlobalUiState([{ op: 'set', path: WORKSPACE_COLOR_PATH, value: color }])
    } else {
      patchGlobalUiState([{ op: 'unset', path: WORKSPACE_COLOR_PATH }])
    }
  }, [])

  // Optimistic insert/update: fork uses this to populate the panel before the sessions_changed SSE lands.
  // Replaces by session_id if present.
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

  // Optimistic, fire-and-forget pin toggle; signals other tabs via PINS_CHANGE_SIGNAL_KEY to refetch ui-state.
  const togglePin = useCallback(sessionId => {
    setPinnedSessions(prev => {
      const isPinned = prev.includes(sessionId)
      if (isPinned) {
        patchGlobalUiState([{ op: 'remove', path: PINNED_PATH, value: sessionId }])
      } else {
        patchGlobalUiState([{ op: 'add', path: PINNED_PATH, value: sessionId }])
      }
      try {
        localStorage.setItem(PINS_CHANGE_SIGNAL_KEY, Date.now().toString())
      } catch {
        // localStorage may be unavailable
      }
      return isPinned ? prev.filter(id => id !== sessionId) : [...prev, sessionId]
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
