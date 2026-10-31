/** Sessions panel showing past sessions with resume action, filtered by a tab strip. */

import { RefreshCw, Search } from 'lucide-react'
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
import { useScrollElementRef } from '../../hooks/useVirtualListGeometry'
import { openSessionInNewTab } from '../../utils/navigation'
import { displayName } from '../../utils/sessionName'
import { sessionRowDisplay } from '../../utils/sessionRow'
import SessionsFilterStrip from './components/SessionsFilterStrip'
import SessionTree, { SessionTreeProvider } from './components/session-tree'
import BoundSessionItem from './components/session-tree/components/BoundSessionItem'
import WindowedSessionRows from './components/WindowedSessionRows'
import {
  buildSearchResults,
  buildSessionTree,
  countTreeRows,
  flattenSessionTree,
  isSessionInTree,
  matchesSessionFilter,
  ORIGIN_FILTERS,
  originIdFor,
  SESSION_FILTER_LABELS,
  SESSION_FILTER_ORDER,
  SESSION_FILTERS,
} from './utils/sessionTree'

const sessionKey = session => session.session_id
const treeRowKey = row => row.key

export default function SessionsPanel() {
  const { sessionId: currentSessionId, sessionName: currentSessionName } = useSessionData()
  const { refreshSession } = useSessionActions()

  const { focusChatTab } = useAppActions()
  const { containerMap, addStoppingSession, deriveSessionStatus } = useContainerMap()

  const { setError: setGlobalError } = useInteraction()

  const { navigateToSession } = useSessionRouting()
  const { workspaceId } = useWorkspace()

  const { isResponding } = useStreamingStatus()
  const {
    sessions,
    pinnedSessions,
    loading,
    error,
    refresh,
    revalidate,
    togglePin,
    panelFilter,
    panelFilterPick,
    setPanelFilter,
    setFallbackToAll,
  } = useSessionsList()
  const pinnedSessionsSet = useMemo(() => new Set(pinnedSessions), [pinnedSessions])
  const { showStillRunningToast } = useStillRunningToast()

  // Trigger background refresh when panel mounts (may have stale data)
  useEffect(() => {
    revalidate()
  }, [revalidate])

  // Local, unpersisted - the chosen filter survives a reload, the query never does.
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const handleSearchOpen = useCallback(() => {
    setSearchOpen(true)
  }, [])

  const handleSearchClose = useCallback(() => {
    setSearchOpen(false)
    setSearchQuery('')
  }, [])

  const handleSearchKeyDown = useCallback(
    e => {
      if (e.key === 'Escape') {
        handleSearchClose()
      }
    },
    [handleSearchClose],
  )

  // A box with a query stays open on blur - clicking a result row must not destroy the query that
  // found it. An empty box closes on blur, the same as clicking away from it.
  const handleSearchBlur = useCallback(() => {
    if (!searchQuery.trim()) {
      setSearchOpen(false)
    }
  }, [searchQuery])

  // Read through a ref so the row callbacks keep their identity while these values change.
  const latestRef = useRef(null)
  latestRef.current = { currentSessionId, currentSessionName, isResponding, containerMap, sessions }

  const executeResume = useCallback(
    sessionId => {
      // Snapshot prior session before navigating so the toast can ask the user to return if still responding.
      const {
        currentSessionId: prevId,
        currentSessionName: prevName,
        isResponding: prevWasResponding,
      } = latestRef.current
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
    [workspaceId, navigateToSession, focusChatTab, showStillRunningToast],
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
      const { containerMap: map, sessions: listed } = latestRef.current
      const containerId =
        map[sessionId] ?? listed.find(s => s.session_id === sessionId)?.container_id
      if (!containerId) {
        return
      }
      addStoppingSession(sessionId)
      deleteContainer(containerId).catch(err =>
        console.debug('SessionsPanel: deleteContainer failed', err),
      )
      // Keep containerMap until the daemon's terminal `stopped` event clears it (ContainerStatusEffect) -
      // dropping it here breaks containerId->sessionId resolution and wedges the stopping indicator.
      refresh()
    },
    [addStoppingSession, refresh],
  )

  const handleRename = useCallback(
    async (sessionId, name) => {
      try {
        await updateSession(sessionId, { name })
        void refresh()
        if (sessionId === latestRef.current.currentSessionId) {
          await refreshSession()
        }
      } catch (_err) {
        setGlobalError('Rename failed')
      }
    },
    [refresh, refreshSession, setGlobalError],
  )

  const handleTogglePin = useCallback(
    sessionId => {
      togglePin(sessionId)
    },
    [togglePin],
  )

  // One tree per filter - each filter's count must reflect what its own tree renders (pinned
  // forks render twice), not the length of the filtered flat list.
  const treesByFilter = useMemo(() => {
    const trees = {}
    for (const filter of SESSION_FILTER_ORDER) {
      const filtered = sessions.filter(s => matchesSessionFilter(filter, s, pinnedSessionsSet))
      trees[filter] = buildSessionTree(filtered, pinnedSessions, currentSessionId)
    }
    return trees
  }, [sessions, pinnedSessions, pinnedSessionsSet, currentSessionId])

  const activeTree = treesByFilter[panelFilter]
  const { rootSessions } = activeTree

  // Bypasses every filter's tree, not just the active one - the whole point is that a match is
  // found whether or not the chosen filter would have listed it.
  const trimmedSearchQuery = searchQuery.trim()
  const isSearching = trimmedSearchQuery.length > 0
  const searchResults = useMemo(
    () =>
      isSearching
        ? buildSearchResults(sessions, trimmedSearchQuery, pinnedSessions, currentSessionId)
        : [],
    [isSearching, trimmedSearchQuery, sessions, pinnedSessions, currentSessionId],
  )

  // Origin lookup for threads/subsessions rows - resolved against the full fetched list (not the
  // filtered one), so an origin excluded by the active filter still resolves to a name.
  const sessionsById = useMemo(() => {
    const map = new Map()
    for (const s of sessions) {
      map.set(s.session_id, s)
    }
    return map
  }, [sessions])

  const isOriginFilter = ORIGIN_FILTERS.has(panelFilter)
  const originSessions = useMemo(() => {
    if (!isOriginFilter) {
      return []
    }
    return sessions.filter(s => matchesSessionFilter(panelFilter, s, pinnedSessionsSet))
  }, [isOriginFilter, panelFilter, sessions, pinnedSessionsSet])

  const [expandedSessions, setExpandedSessions] = useState(new Set())
  const manuallyCollapsedRef = useRef(new Set())
  const treeRows = useMemo(
    () => flattenSessionTree(activeTree, expandedSessions),
    [activeTree, expandedSessions],
  )
  const [listEl, attachListRef] = useScrollElementRef()

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

  // Fallback to All: evaluated once per change of the OPEN session, never on a refresh. The flag
  // it sets is derived - the stored pick never moves, so returning to a listed session clears it.
  const filterCheckRef = useRef({ panelFilterPick, treesByFilter, setFallbackToAll })
  filterCheckRef.current = { panelFilterPick, treesByFilter, setFallbackToAll }
  // audit-ignore: session-transition-guard - a filter baseline, not per-session state
  const lastCheckedSessionIdRef = useRef(undefined)
  const hasFilterBaselineRef = useRef(false)

  useEffect(() => {
    if (!currentSessionId) {
      return
    }
    // The first truthy currentSessionId - whether on mount or once async routing resolves it from
    // null - is a baseline, not a change: it must not itself trigger the fallback.
    if (!hasFilterBaselineRef.current) {
      hasFilterBaselineRef.current = true
      lastCheckedSessionIdRef.current = currentSessionId
      return
    }
    if (currentSessionId === lastCheckedSessionIdRef.current) {
      return
    }
    lastCheckedSessionIdRef.current = currentSessionId

    const {
      panelFilterPick: pick,
      treesByFilter: trees,
      setFallbackToAll: setFallback,
    } = filterCheckRef.current
    if (pick === SESSION_FILTERS.ALL) {
      return
    }

    const present = isSessionInTree(trees[pick], currentSessionId)
    setFallback(!present)
  }, [currentSessionId])

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

  const filterIsEmpty = isOriginFilter ? originSessions.length === 0 : rootSessions.length === 0

  // Shared by the origin-filter branch and by search results - the two flat, non-tree row lists.
  const renderSessionRow = (session, originName) => (
    <BoundSessionItem
      session={session}
      {...sessionRowDisplay(session, deriveSessionStatus)}
      isCurrent={session.session_id === currentSessionId}
      isPinned={pinnedSessionsSet.has(session.session_id)}
      originName={originName}
      onResume={handleResume}
      onRename={handleRename}
      onTogglePin={handleTogglePin}
      onKillContainer={handleKillContainer}
      onOpenInNewTab={handleOpenInNewTab}
    />
  )

  return (
    <div className="sessions-panel" data-testid="panel-sessions">
      <div className="sessions-panel-header">
        {searchOpen ? (
          <input
            type="text"
            className="sessions-search-input"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            onBlur={handleSearchBlur}
            placeholder="Search sessions..."
            autoFocus
            data-testid="sessions-search-input"
          />
        ) : (
          <SessionsFilterStrip
            activeFilter={panelFilter}
            onSelectFilter={setPanelFilter}
            getCount={filter => countTreeRows(treesByFilter[filter])}
          />
        )}
        <div className="sessions-panel-buttons">
          <NewSessionSplitButton dropdownPlacement="portal" hoverVariant="plain" />
          {!searchOpen && (
            <button
              type="button"
              className="sessions-search-toggle"
              data-testid="sessions-search-toggle"
              onClick={handleSearchOpen}
              title="Search sessions">
              <Search size={12} />
            </button>
          )}
          <button
            type="button"
            className="sessions-refresh"
            data-testid="session-refresh-btn"
            onClick={refresh}
            title="Refresh">
            <RefreshCw size={12} />
          </button>
        </div>
      </div>
      <div className="sessions-list" ref={attachListRef}>
        {isSearching ? (
          searchResults.length === 0 ? (
            <p className="sessions-filter-empty">No sessions match "{trimmedSearchQuery}"</p>
          ) : (
            <WindowedSessionRows
              scrollEl={listEl}
              rows={searchResults}
              getKey={sessionKey}
              renderRow={session => renderSessionRow(session)}
            />
          )
        ) : filterIsEmpty ? (
          <p className="sessions-filter-empty">
            No {SESSION_FILTER_LABELS[panelFilter].toLowerCase()} sessions
          </p>
        ) : isOriginFilter ? (
          <WindowedSessionRows
            scrollEl={listEl}
            rows={originSessions}
            getKey={sessionKey}
            withOrigin
            renderRow={session =>
              renderSessionRow(
                session,
                displayName(sessionsById.get(originIdFor(panelFilter, session))),
              )
            }
          />
        ) : (
          <SessionTreeProvider
            currentSessionId={currentSessionId}
            pinnedSessions={pinnedSessionsSet}
            deriveSessionStatus={deriveSessionStatus}
            onResume={handleResume}
            onRename={handleRename}
            onTogglePin={handleTogglePin}
            onToggleExpanded={toggleExpanded}
            onKillContainer={handleKillContainer}
            onOpenInNewTab={handleOpenInNewTab}>
            <WindowedSessionRows
              scrollEl={listEl}
              rows={treeRows}
              getKey={treeRowKey}
              renderRow={row => (
                <SessionTree
                  session={row.session}
                  depth={row.depth}
                  isLastChild={row.isLastChild}
                  continuations={row.continuations}
                  hasChildren={row.hasChildren}
                  isExpanded={row.isExpanded}
                  hiddenSessions={row.hiddenSessions}
                />
              )}
            />
          </SessionTreeProvider>
        )}
      </div>
    </div>
  )
}
