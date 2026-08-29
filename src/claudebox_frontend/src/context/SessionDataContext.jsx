/** Session data context - polled session metadata from API. */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getContainerId, setContainerId } from '../api/apiClient'
import { setEffortLevel as apiSetEffortLevel } from '../api/effortLevels'
import { setModel as apiSetModel } from '../api/models'
import { setPermissionMode as apiSetPermissionMode } from '../api/permissionModes'
import { getSession, resumeSession } from '../api/sessions'
import { getUiState, patchSessionUiState } from '../api/uiState'
import { getSessionDefaults } from '../api/workspaces'
import { SESSION_POLL_INTERVAL, SESSION_RETRY_DELAY_MS } from '../config/timing'
import useWorkspaceCommandCatalog from '../hooks/useWorkspaceCommandCatalog'
import { createDeferred } from '../utils/deferred'
import { useDaemonStreamContext } from './DaemonStreamContext'
import { useEvents } from './EventsContext'
import { WorkspaceContext } from './WorkspaceContext'

const SessionDataContext = createContext(null)
const SessionActionsContext = createContext(null)

/**
 * Low-frequency context - updates on connect and during polling; also handles browser/tab title updates.
 *
 * Internally provides two contexts:
 * - SessionDataContext: read-only derived data (re-renders when session changes)
 * - SessionActionsContext: stable action callbacks (rarely re-renders)
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - Child components.
 * @param {Function} props.onSessionAttach - Fires on session id change; binds layout-save, one-shot restore.
 * @param {Function} props.onError - Called with error message on fetch failure.
 */
export function SessionDataProvider({ children, onSessionAttach, onError }) {
  const { isConnected, isResponding, reconnectSSE, notifyContainerChanged } = useEvents()
  const { sessionsChanged, lastSessionsChangedContainerId } = useDaemonStreamContext()
  const workspaceContext = useContext(WorkspaceContext)
  const workspaceId = workspaceContext?.workspaceId ?? null

  const [sessionData, setSessionData] = useState(null)
  const [availableModels, setAvailableModels] = useState([])
  const [availablePermissionModes, setAvailablePermissionModes] = useState([])
  const [availableEffortLevels, setAvailableEffortLevels] = useState([])
  // Pre-session workspace from session-defaults; sole source for the tab title before getSession() resolves.
  const [defaultsWorkspace, setDefaultsWorkspace] = useState(null)
  const [notificationsEnabled, setNotificationsEnabledState] = useState(false)
  // Welcome-screen catalog: populated pre-session from the daemon endpoint so the picker isn't empty.
  // Falls through to `sessionData.commands` once a session is alive.
  const workspaceCommandCatalog = useWorkspaceCommandCatalog()
  const wasRespondingRef = useRef(false)
  const fetchRetryCountRef = useRef(0)
  // Coalesces the poll interval, SSE signals and picker confirmations onto one request - the poll
  // fires faster than its own bound, so overlapping copies would each pin a connection slot.
  const refreshInFlightRef = useRef(null)
  // A caller that joined an in-flight request re-fetches once on settle, so a picker confirmation
  // never reads state captured before its own mutation.
  const refreshPendingRef = useRef(false)
  // The container the in-flight request was addressed to. A switch mid-flight must not apply the
  // old container's session to the new one, so a mismatch issues its own request.
  const refreshInFlightContainerRef = useRef(null)
  // Set by the first joiner of an in-flight request; resolves once the re-armed refetch settles -
  // never the request being joined, which predates the joiner's own call.
  const nextSettleDeferredRef = useRef(null)
  const isConnectedRef = useRef(isConnected)
  isConnectedRef.current = isConnected

  // Pre-session picker-change buffer; drained in strict order (model -> permission -> effort) once attached.
  // Latest-wins: repeated picker changes overwrite the buffered value before drain.
  const [deferredModel, setDeferredModel] = useState(null)
  const [deferredPermissionMode, setDeferredPermissionMode] = useState(null)
  const [deferredEffortLevel, setDeferredEffortLevel] = useState(null)
  const lastSessionIdRef = useRef(null)

  // Retains seeded non-null fields when getSession() returns null for them, avoiding a footer regression to "-".
  // A joiner is handed a deferred for the NEXT settle, not the request it joined; the try/catch
  // below never re-throws, so it always resolves in practice.
  const refreshSession = useCallback(async () => {
    const addressedContainer = getContainerId()

    if (refreshInFlightRef.current && refreshInFlightContainerRef.current === addressedContainer) {
      refreshPendingRef.current = true
      if (!nextSettleDeferredRef.current) {
        nextSettleDeferredRef.current = createDeferred()
      }
      return nextSettleDeferredRef.current.promise
    }

    // A wave armed against a superseded container's request would never settle - the switch has
    // moved past it, so settle it here rather than let it attach to this unrelated request.
    if (refreshPendingRef.current) {
      refreshPendingRef.current = false
      const orphaned = nextSettleDeferredRef.current
      nextSettleDeferredRef.current = null
      orphaned?.resolve()
    }

    const run = (async () => {
      try {
        const data = await getSession()
        fetchRetryCountRef.current = 0
        // Only the run that still owns the slot may apply its response - a container switch can
        // start a second run for a different container while this one is still in flight.
        if (refreshInFlightRef.current === run) {
          if (data?.session_id) {
            setSessionData(prev => {
              if (!prev || prev.session_id !== data.session_id) {
                return data
              }
              const merged = { ...prev }
              for (const [k, v] of Object.entries(data)) {
                if (v != null) {
                  merged[k] = v
                }
              }
              return merged
            })
            return
          }
          // No session_id yet - store partial data (e.g. workspace) and retry
          if (data && Object.keys(data).length > 0) {
            setSessionData(prev => (prev ? { ...prev, ...data } : data))
          }
          setTimeout(refreshSession, SESSION_RETRY_DELAY_MS)
        }
      } catch (e) {
        // Only the run that still owns the slot may act on its failure - a container switch can
        // start a second run for a different container while this one is still in flight.
        if (refreshInFlightRef.current !== run) {
          return
        }
        // Don't retry when SSE is disconnected - container is gone
        if (!isConnectedRef.current) {
          return
        }
        const attempt = fetchRetryCountRef.current
        if (attempt < 3) {
          fetchRetryCountRef.current = attempt + 1
          const backoff = 1000 * 2 ** attempt
          console.warn(`SessionDataContext: Retry ${attempt + 1}/3 in ${backoff}ms`, e)
          setTimeout(refreshSession, backoff)
        } else {
          fetchRetryCountRef.current = 0
          console.warn('SessionDataContext: Failed to refresh session after retries', e)
          onError?.('Session load failed')
        }
      } finally {
        // Only the run that still owns the slot may release it - a container switch can start a
        // second run alongside this one, and it must keep its own claim.
        if (refreshInFlightRef.current === run) {
          refreshInFlightRef.current = null
          refreshInFlightContainerRef.current = null

          if (refreshPendingRef.current) {
            refreshPendingRef.current = false
            const deferred = nextSettleDeferredRef.current
            nextSettleDeferredRef.current = null
            refreshSession().then(deferred.resolve, deferred.reject)
          }
        }
      }
    })()

    refreshInFlightRef.current = run
    refreshInFlightContainerRef.current = addressedContainer

    return run
  }, [onError])

  // Clear session data (used by reconnect composition)
  const clearSessionData = useCallback(() => {
    setSessionData(null)
  }, [])

  // Seed session data with known values before container responds
  const seedSessionData = useCallback(seed => {
    setSessionData(seed)
  }, [])

  // Merge partial updates into existing session data (e.g. session_id after API returns)
  const mergeSessionData = useCallback(patch => {
    setSessionData(prev => (prev ? { ...prev, ...patch } : patch))
  }, [])

  const reloadSession = useCallback(async () => {
    if (!sessionData?.session_id) {
      return
    }
    try {
      const data = await resumeSession(sessionData.session_id)
      setContainerId(data.container_id)
      notifyContainerChanged()
      setSessionData(null)
      reconnectSSE()
    } catch (_err) {
      onError?.('Reload failed')
    }
  }, [sessionData?.session_id, reconnectSSE, notifyContainerChanged, onError])

  // Toggle notifications with persistence
  const setNotificationsEnabled = useCallback(
    enabled => {
      setNotificationsEnabledState(enabled)
      if (sessionData?.session_id) {
        patchSessionUiState(sessionData.session_id, [
          { op: 'set', path: 'notificationsEnabled', value: enabled },
        ])
      }
    },
    [sessionData?.session_id],
  )

  // Sets model via API then refreshes to confirm from projection; buffers pre-session (no container) until attach.
  const setModel = useCallback(
    newModel => {
      if (!getContainerId()) {
        setDeferredModel(newModel)
        return
      }
      apiSetModel(newModel)
        .then(refreshSession)
        .catch(() => refreshSession())
    },
    [refreshSession],
  )

  // Sets permission mode via API then refreshes to confirm; buffers pre-session (no container) until attach.
  const setPermissionMode = useCallback(
    newPermissionMode => {
      if (!getContainerId()) {
        setDeferredPermissionMode(newPermissionMode)
        return
      }
      apiSetPermissionMode(newPermissionMode)
        .then(refreshSession)
        .catch(() => refreshSession())
    },
    [refreshSession],
  )

  // Sets effort level via API then refreshes to confirm; buffers pre-session (no container) until attach.
  const setEffortLevel = useCallback(
    newLevel => {
      if (!getContainerId()) {
        setDeferredEffortLevel(newLevel)
        return
      }
      apiSetEffortLevel(newLevel)
        .then(refreshSession)
        .catch(() => refreshSession())
    },
    [refreshSession],
  )

  // Load notifications preference when session ID becomes available
  useEffect(() => {
    if (sessionData?.session_id) {
      getUiState(sessionData.session_id)
        .then(data => setNotificationsEnabledState(data.session?.notificationsEnabled ?? false))
        .catch(() => setNotificationsEnabledState(false))
    }
  }, [sessionData?.session_id])

  // Drains the pre-session buffer on attach, in strict order: model -> permission -> effort.
  // Each await confirms the SDK applied one change first; a failed call surfaces via onError, others still apply.
  // useChatController's deferred message fires only once this drain completes (same session_id transition).
  useEffect(() => {
    const previousId = lastSessionIdRef.current
    const sessionId = sessionData?.session_id
    lastSessionIdRef.current = sessionId
    if (!sessionId || previousId) {
      return
    }
    if (!(deferredModel || deferredPermissionMode || deferredEffortLevel)) {
      return
    }

    const drainModel = deferredModel
    const drainPermissionMode = deferredPermissionMode
    const drainEffortLevel = deferredEffortLevel
    setDeferredModel(null)
    setDeferredPermissionMode(null)
    setDeferredEffortLevel(null)

    ;(async () => {
      try {
        if (drainModel) {
          await apiSetModel(drainModel)
        }
      } catch {
        onError?.('Failed to apply buffered model')
      }
      try {
        if (drainPermissionMode) {
          await apiSetPermissionMode(drainPermissionMode)
        }
      } catch {
        onError?.('Failed to apply buffered permission mode')
      }
      try {
        if (drainEffortLevel) {
          await apiSetEffortLevel(drainEffortLevel)
        }
      } catch {
        onError?.('Failed to apply buffered effort level')
      }
      void refreshSession()
    })()
  }, [
    sessionData?.session_id,
    deferredModel,
    deferredPermissionMode,
    deferredEffortLevel,
    refreshSession,
    onError,
  ])

  // Populates model/permission/effort picker options from the workspace-scoped session-defaults endpoint.
  // Single source of truth for picker dropdowns - the daemon serves the same constants the container would.
  useEffect(() => {
    if (!workspaceId) {
      return
    }
    let cancelled = false
    getSessionDefaults()
      .then(data => {
        if (cancelled) {
          return
        }
        if (data.workspace) {
          setDefaultsWorkspace(data.workspace)
        }
        if (data.available_models) {
          setAvailableModels(data.available_models)
        }
        if (data.available_permission_modes) {
          setAvailablePermissionModes(data.available_permission_modes)
        }
        if (data.available_effort_levels) {
          setAvailableEffortLevels(data.available_effort_levels)
        }
      })
      .catch(err => {
        // Best-effort - pickers fall through to their existing `-` display
        console.warn('SessionDataContext: getSessionDefaults failed', err)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  // Initial fetch on connect
  useEffect(() => {
    if (isConnected) {
      void refreshSession()
    }
  }, [isConnected, refreshSession])

  // Refresh when daemon signals sessions changed (cross-tab rename, fork, etc.)
  // Scoped events (mutation observer) only refresh when this tab's container matches
  useEffect(() => {
    if (sessionsChanged > 0) {
      if (!lastSessionsChangedContainerId || lastSessionsChangedContainerId === getContainerId()) {
        void refreshSession()
      }
    }
  }, [sessionsChanged, lastSessionsChangedContainerId, refreshSession])

  // Poll while responding, fetch once more when stopped
  useEffect(() => {
    if (isResponding) {
      wasRespondingRef.current = true
      const interval = setInterval(refreshSession, SESSION_POLL_INTERVAL)
      return () => clearInterval(interval)
    } else if (wasRespondingRef.current) {
      wasRespondingRef.current = false
      void refreshSession()
    }
  }, [isResponding, refreshSession])

  // Tab title: [name] | [workspace] | Claudebox; falls back to the session-defaults workspace pre-connect.
  useEffect(() => {
    const name = sessionData?.name
    const workspace = sessionData?.workspace || defaultsWorkspace
    const workspaceName = workspace ? workspace.split('/').pop() : null

    const parts = []
    if (name) {
      parts.push(name)
    }
    if (workspaceName) {
      parts.push(workspaceName)
    }
    parts.push('Claudebox')

    document.title = parts.join(' | ')
  }, [sessionData?.name, sessionData?.workspace, defaultsWorkspace])

  // Notifies the dockview hook of session attach/detach so it can bind sessionIdRef (layout-save path).
  // This also triggers the one-shot per-session layout restore on first attach.
  useEffect(() => {
    onSessionAttach?.(sessionData?.session_id ?? null)
  }, [sessionData?.session_id, onSessionAttach])

  // Read-only data context value
  const dataValue = useMemo(
    () => ({
      sessionData,
      sessionId: sessionData?.session_id || null,
      sessionName: sessionData?.name || null,
      sessionDir: sessionData?.session_dir || null,
      model: sessionData?.model || null,
      permissionMode: sessionData?.permission_mode || null,
      workspace: sessionData?.workspace || null,
      numTurns: sessionData?.num_turns ?? 0,
      todos: sessionData?.todos || [],
      totalCostUsd: sessionData?.total_cost_usd ?? 0,
      totalDurationMs: sessionData?.total_duration_ms ?? 0,
      lastContextTokens: sessionData?.last_context_tokens ?? 0,
      contextWindow: sessionData?.context_window ?? 1000000,
      commands: sessionData?.commands || workspaceCommandCatalog || {},
      sessionPrompt: sessionData?.session_prompt || null,
      effortLevel: sessionData?.effort_level || null,
      capabilities: sessionData?.capabilities || null,
      runtimeName: sessionData?.runtime_name || null,
      rateLimits: sessionData?.rate_limits || null,
      availableModels,
      availablePermissionModes,
      availableEffortLevels,
      notificationsEnabled,
    }),
    [
      sessionData,
      availableModels,
      availablePermissionModes,
      availableEffortLevels,
      notificationsEnabled,
      workspaceCommandCatalog,
    ],
  )

  // Stable actions context value
  const actionsValue = useMemo(
    () => ({
      setModel,
      setPermissionMode,
      setEffortLevel,
      setNotificationsEnabled,
      refreshSession,
      reloadSession,
      clearSessionData,
      seedSessionData,
      mergeSessionData,
    }),
    [
      setModel,
      setPermissionMode,
      setEffortLevel,
      setNotificationsEnabled,
      refreshSession,
      reloadSession,
      clearSessionData,
      seedSessionData,
      mergeSessionData,
    ],
  )

  return (
    <SessionDataContext.Provider value={dataValue}>
      <SessionActionsContext.Provider value={actionsValue}>
        {children}
      </SessionActionsContext.Provider>
    </SessionDataContext.Provider>
  )
}

/** Access session metadata from the container API. */
export function useSessionData() {
  const context = useContext(SessionDataContext)
  if (!context) {
    throw new Error('useSessionData must be used within SessionDataProvider')
  }
  return context
}

/** Access only session directory path. Safe outside provider (returns null). */
export function useSessionDir() {
  return useContext(SessionDataContext)?.sessionDir || null
}

/** Access only session ID. Safe outside provider (returns null). */
export function useSessionId() {
  return useContext(SessionDataContext)?.sessionId || null
}

/** Access session action callbacks (setModel, refreshSession, etc.). */
export function useSessionActions() {
  const context = useContext(SessionActionsContext)
  if (!context) {
    throw new Error('useSessionActions must be used within SessionDataProvider')
  }
  return context
}
