/** Sessions panel showing past sessions with resume action. */

import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { deleteContainer } from '../../api/containers'
import { updateSession } from '../../api/sessions'
import NewSessionSplitButton from '../../components/NewSessionSplitButton'
import { useAppActions } from '../../context/AppActionsContext'
import { useContainerMap } from '../../context/ContainerMapContext'
import { useInteraction } from '../../context/InteractionContext'
import { useSessionActions, useSessionData } from '../../context/SessionDataContext'
import { useSessionRouting } from '../../context/SessionRoutingContext'
import { useSessionsList } from '../../context/SessionsContext'
import { useStillRunningToast } from '../../context/StillRunningToastContext'
import { useStreamingStatus } from '../../context/StreamingStatusContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { openSessionInNewTab } from '../../utils/navigation'
import SessionTree, { SessionTreeProvider } from './components/session-tree'
import { buildSessionTree } from './utils/sessionTree'

/** Render sessions panel showing past sessions with resume action. */
export default function SessionsPanel() {
  const { sessionId: currentSessionId, sessionName: currentSessionName } = useSessionData()
  const { refreshSession } = useSessionActions()

  const { focusChatTab } = useAppActions()
  const { containerMap, addStoppingSession } = useContainerMap()

  const { setError: setGlobalError } = useInteraction()

  const { navigateToSession } = useSessionRouting()
  const { workspaceId } = useWorkspace()

  const { isResuming, isReplaying, isResponding } = useStreamingStatus()
  const { sessions, pinnedSessions, loading, error, refresh, togglePin } = useSessionsList()
  const pinnedSessionsSet = useMemo(() => new Set(pinnedSessions), [pinnedSessions])
  const { showStillRunningToast } = useStillRunningToast()

  // Trigger background refresh when panel mounts (may have stale data)
  useEffect(() => {
    refresh()
  }, [refresh])

  const executeResume = useCallback(
    sessionId => {
      // Snapshot prior session state BEFORE navigation so the toast can ask
      // the user to return if Claude was responding when we replaced.
      const prevId = currentSessionId
      const prevName = currentSessionName
      const prevWasResponding = isResponding
      if (workspaceId) {
        navigateToSession(workspaceId, sessionId)
      }
      focusChatTab()
      if (prevWasResponding && prevId && prevId !== sessionId && workspaceId) {
        showStillRunningToast({
          sessionName: prevName || prevId.slice(0, 8),
          onReturn: () => navigateToSession(workspaceId, prevId),
        })
      }
    },
    [
      workspaceId,
      navigateToSession,
      focusChatTab,
      currentSessionId,
      currentSessionName,
      isResponding,
      showStillRunningToast,
    ],
  )

  const handleResume = useCallback(
    sessionId => {
      executeResume(sessionId)
    },
    [executeResume],
  )

  const handleOpenInNewTab = useCallback(
    sessionId => {
      if (workspaceId) {
        openSessionInNewTab(workspaceId, sessionId)
      }
    },
    [workspaceId],
  )

  const handleKillContainer = useCallback(
    sessionId => {
      const containerId =
        containerMap[sessionId] ?? sessions.find(s => s.session_id === sessionId)?.container_id
      if (!containerId) {
        return
      }
      addStoppingSession(sessionId)
      deleteContainer(containerId).catch(err =>
        console.debug('SessionsPanel: deleteContainer failed', err),
      )
      // Keep the containerMap mapping until the daemon's terminal `stopped`
      // event clears it (ContainerStatusEffect) — dropping it here breaks the
      // containerId→sessionId resolution and wedges the stopping indicator.
      refresh()
    },
    [containerMap, sessions, addStoppingSession, refresh],
  )

  const handleRename = useCallback(
    async (sessionId, name) => {
      try {
        await updateSession(sessionId, { name })
        void refresh()
        if (sessionId === currentSessionId) {
          await refreshSession()
        }
      } catch (_err) {
        setGlobalError('Rename failed')
      }
    },
    [refresh, refreshSession, currentSessionId, setGlobalError],
  )

  const handleTogglePin = useCallback(
    sessionId => {
      togglePin(sessionId)
    },
    [togglePin],
  )

  const { rootSessions, childrenMap } = useMemo(
    () => buildSessionTree(sessions, pinnedSessions, currentSessionId),
    [sessions, pinnedSessions, currentSessionId],
  )

  // Track expanded state for sessions with children
  const [expandedSessions, setExpandedSessions] = useState(new Set())
  const manuallyCollapsedRef = useRef(new Set())

  // Auto-expand ancestor chain of active session (skip for pinned sessions)
  useEffect(() => {
    if (!currentSessionId || sessions.length === 0) {
      return
    }
    if (pinnedSessionsSet.has(currentSessionId)) {
      setExpandedSessions(new Set())
      manuallyCollapsedRef.current = new Set()
      return
    }
    const sessionMap = new Map(sessions.map(s => [s.session_id, s]))
    const ancestors = new Set()
    let current = sessionMap.get(currentSessionId)
    while (current?.parent_session_id) {
      ancestors.add(current.parent_session_id)
      current = sessionMap.get(current.parent_session_id)
    }
    setExpandedSessions(prev => {
      const next = new Set(prev)
      for (const id of ancestors) {
        if (!manuallyCollapsedRef.current.has(id)) {
          next.add(id)
        }
      }
      return next
    })
  }, [currentSessionId, sessions, pinnedSessionsSet])

  const toggleExpanded = useCallback(sessionId => {
    setExpandedSessions(prev => {
      const next = new Set(prev)
      if (next.has(sessionId)) {
        next.delete(sessionId)
        manuallyCollapsedRef.current.add(sessionId)
      } else {
        next.add(sessionId)
        manuallyCollapsedRef.current.delete(sessionId)
      }
      return next
    })
  }, [])

  if (isResuming || isReplaying) {
    return (
      <div className="sessions-panel sessions-loading" data-testid="panel-sessions">
        Resuming...
      </div>
    )
  }

  if (loading && sessions.length === 0) {
    return (
      <div className="sessions-panel sessions-loading" data-testid="panel-sessions">
        Loading...
      </div>
    )
  }

  if (error && sessions.length === 0) {
    return (
      <div className="sessions-panel sessions-error" data-testid="panel-sessions">
        <p>Failed to load sessions</p>
        <button type="button" onClick={refresh}>
          Retry
        </button>
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="sessions-panel sessions-empty" data-testid="panel-sessions">
        No sessions yet
      </div>
    )
  }

  return (
    <div className="sessions-panel" data-testid="panel-sessions">
      <div className="sessions-panel-header">
        <NewSessionSplitButton dropdownPlacement="portal" hoverVariant="plain" />
        <button
          type="button"
          className="sessions-refresh"
          data-testid="session-refresh-btn"
          onClick={refresh}
          title="Refresh">
          <RefreshCw size={12} />
        </button>
      </div>
      <div className="sessions-list">
        <SessionTreeProvider
          childrenMap={childrenMap}
          expandedSessions={expandedSessions}
          currentSessionId={currentSessionId}
          pinnedSessions={pinnedSessionsSet}
          onResume={handleResume}
          onRename={handleRename}
          onTogglePin={handleTogglePin}
          onToggleExpanded={toggleExpanded}
          onKillContainer={handleKillContainer}
          onOpenInNewTab={handleOpenInNewTab}>
          {rootSessions.map((session, index) => (
            <SessionTree
              key={session.session_id}
              session={session}
              depth={0}
              isLastChild={index === rootSessions.length - 1}
            />
          ))}
        </SessionTreeProvider>
      </div>
    </div>
  )
}
