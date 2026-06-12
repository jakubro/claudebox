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
import { useDaemonStreamContext } from './DaemonStreamContext'
import { useEvents } from './EventsContext'
import { WorkspaceContext } from './WorkspaceContext'

const SessionDataContext = createContext(null)
const SessionActionsContext = createContext(null)

/**
 * Provide session metadata from the container API.
 *
 * This is a low-frequency context - updates on connect and during polling.
 * Handles browser/tab title updates.
 *
 * Internally provides two contexts:
 * - SessionDataContext: read-only derived data (re-renders when session changes)
 * - SessionActionsContext: stable action callbacks (rarely re-renders)
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - Child components.
 * @param {Function} props.onSessionAttach - Called with the active session id whenever it changes; used to bind the layout-save sessionId and run the one-shot per-session layout restore.
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
  // Pre-session workspace from session-defaults - sole source for browser tab
  // title before getSession() resolves on connect (SPEC §1.7 pre-init form).
  const [defaultsWorkspace, setDefaultsWorkspace] = useState(null)
  const [notificationsEnabled, setNotificationsEnabledState] = useState(false)
  // Welcome-screen slash-command catalog - populated from the daemon endpoint
  // pre-session so the picker is non-empty before any container attaches.
  // Falls through to `sessionData.commands` once a session is alive.
  const workspaceCommandCatalog = useWorkspaceCommandCatalog()
  const wasRespondingRef = useRef(false)
  const fetchRetryCountRef = useRef(0)
  const isConnectedRef = useRef(isConnected)
  isConnectedRef.current = isConnected

  // Pre-session config buffer - picker changes made before any session
  // attaches (welcome screen) are stored here, then drained in strict order
  // (model -> permission -> effort) once the session is ready. Latest-wins:
  // repeated picker changes overwrite the buffered value before drain.
  const [deferredModel, setDeferredModel] = useState(null)
  const [deferredPermissionMode, setDeferredPermissionMode] = useState(null)
  const [deferredEffortLevel, setDeferredEffortLevel] = useState(null)
  const lastSessionIdRef = useRef(null)

  // Fetch session data, retrying with backoff on transient errors.
  // Defensive merge: when the create-response seeded sessionData with
  // synthesized defaults (e.g. effort_level="xhigh") and a subsequent partial
  // getSession() returns null for those fields, retain the seeded non-null
  // values so the footer doesn't regress to "-".
  const refreshSession = useCallback(async () => {
    try {
      const data = await getSession()
      fetchRetryCountRef.current = 0
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
    } catch (e) {
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
    }
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

  // Reload session - restart container with same session ID, then reconnect
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

  // Set model via API then refresh to confirm from projection.
  // No active container (welcome screen) -> buffer; drain on session attach.
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

  // Set permission mode via API then refresh to confirm from projection.
  // No active container (welcome screen) -> buffer; drain on session attach.
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

  // Set effort level via API then refresh to confirm from projection.
  // No active container (welcome screen) -> buffer; drain on session attach.
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

  // Drain pre-session config buffer when a session attaches (welcome -> chat).
  // Strict order: model -> permission -> effort. Each await ensures the SDK
  // applied the change before the next call. A failed call surfaces via
  // onError and the remaining successful changes still apply; the deferred
  // message in useChatController fires only after this drain completes
  // because both effects key off the same session_id transition.
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

  // Populate available models / permission modes / effort levels from the
  // workspace-scoped session-defaults endpoint whenever workspaceId is set.
  // This is the single source of truth for picker dropdowns - the daemon
  // serves the same module-level constants the container would.
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

  // Update browser tab title: [name] | [workspace] | Claudebox.
  // Pre-init form falls back to session-defaults workspace so the title is
  // populated before getSession() resolves (SPEC §1.7).
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

  // Notify the dockview hook of session attach/detach so it can bind sessionIdRef
  // (consumed by the layout-save path) and run the one-shot per-session layout
  // restore on first attach.
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
