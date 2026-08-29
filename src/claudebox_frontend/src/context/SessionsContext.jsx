/** Sessions list context with SSE-driven refresh. */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { listSessions } from '../api/sessions'
import { getUiState, patchGlobalUiState } from '../api/uiState'
import { SESSION_FILTERS } from '../config/sessionFilters'
import {
  PINNED_PATH,
  PINS_CHANGE_SIGNAL_KEY,
  SESSIONS_PANEL_FILTER_PATH,
  WORKSPACE_COLOR_PATH,
} from '../config/storage'
import {
  SESSION_STORAGE_SWEEP_INTERVAL_MS,
  SESSIONS_CHANGED_DEBOUNCE_MS,
  SESSIONS_REFRESH_FALLBACK_MS,
} from '../config/timing'
import { createDeferred } from '../utils/deferred'
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
  // The reader's own choice - stored, hydrated, written only by setPanelFilter.
  const [panelFilterPick, setPanelFilterPickState] = useState(SESSION_FILTERS.CONVERSATIONS)
  // Unstored: true while the open session is absent from panelFilterPick. SessionsPanel owns when
  // this flips; a click always clears it, so it can never outlive the session change that set it.
  const [fallbackToAll, setFallbackToAll] = useState(false)
  const panelFilterHydratedRef = useRef(false)
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
  // lose it until the fallback poll.
  const pendingSignalRef = useRef(false)
  // Set by the first joiner of an in-flight request; resolves once the re-armed refetch settles -
  // never the request being joined, which predates the joiner's own call.
  const nextSettleDeferredRef = useRef(null)
  const sweepLastRunAtRef = useRef(0)

  const fetchSessions = useCallback(async () => {
    if (!workspaceId) {
      return
    }
    if (fetchInFlightRef.current && fetchInFlightWorkspaceRef.current === workspaceId) {
      pendingSignalRef.current = true
      if (!nextSettleDeferredRef.current) {
        nextSettleDeferredRef.current = createDeferred()
      }
      return nextSettleDeferredRef.current.promise
    }

    // A wave armed against a superseded workspace's request would never settle - the switch has
    // moved past it, so settle it here rather than let it attach to this unrelated request.
    if (pendingSignalRef.current) {
      pendingSignalRef.current = false
      const orphaned = nextSettleDeferredRef.current
      nextSettleDeferredRef.current = null
      orphaned?.resolve()
    }

    const run = (async () => {
      try {
        const [sessionsData, uiStateData] = await Promise.all([listSessions(), getUiState()])
        // Only the run that still owns the slot may apply its response - a workspace switch can
        // start a second run for a different workspace while this one is still in flight.
        if (fetchInFlightRef.current === run) {
          const liveSessions = sessionsData.sessions || []
          setSessions(liveSessions)
          setPinnedSessions(uiStateData.global?.pinnedSessions || [])
          setWorkspaceColorState(uiStateData.global?.workspaceColor || null)
          // Hydrate once - a later refetch must not stomp a filter the reader picked meanwhile.
          if (!panelFilterHydratedRef.current) {
            panelFilterHydratedRef.current = true
            setPanelFilterPickState(
              uiStateData.global?.sessionsPanelFilter || SESSION_FILTERS.CONVERSATIONS,
            )
          }
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
        }
      } catch (err) {
        if (fetchInFlightRef.current === run) {
          setError(err.message)
        }
      } finally {
        if (fetchInFlightRef.current === run) {
          setLoading(false)
          fetchInFlightRef.current = null
          fetchInFlightWorkspaceRef.current = null
          lastFetchCompletedAtRef.current = Date.now()
          if (pendingSignalRef.current) {
            pendingSignalRef.current = false
            // The debounced-signal effect below can arm this flag directly, without going
            // through the join branch above, so a deferred isn't guaranteed to exist here.
            const deferred = nextSettleDeferredRef.current
            nextSettleDeferredRef.current = null
            if (deferred) {
              fetchSessions().then(deferred.resolve, deferred.reject)
            } else {
              fetchSessions()
            }
          }
        }
      }
    })()

    fetchInFlightRef.current = run
    fetchInFlightWorkspaceRef.current = workspaceId
    return run
  }, [workspaceId])

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
        fetchSessions()
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

  // Optimistic, fire-and-forget filter choice; persists so a reload returns to the same tab.
  // Clears any standing fallback - a click is the reader overriding whatever the panel picked.
  const setPanelFilter = useCallback(filter => {
    setPanelFilterPickState(filter)
    setFallbackToAll(false)
    patchGlobalUiState([{ op: 'set', path: SESSIONS_PANEL_FILTER_PATH, value: filter }])
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

  // The strip renders and the list filters by this - the pick, or All while the fallback is set.
  const panelFilter = fallbackToAll ? SESSION_FILTERS.ALL : panelFilterPick

  const value = useMemo(
    () => ({
      sessions,
      pinnedSessions,
      workspaceColor,
      panelFilter,
      panelFilterPick,
      loading,
      error,
      refresh: fetchSessions,
      togglePin,
      setWorkspaceColor,
      setPanelFilter,
      setFallbackToAll,
      seedSession,
    }),
    [
      sessions,
      pinnedSessions,
      workspaceColor,
      panelFilter,
      panelFilterPick,
      loading,
      error,
      fetchSessions,
      togglePin,
      setWorkspaceColor,
      setPanelFilter,
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
