/** Hash-based session routing - reads URL hash, exposes navigation functions. */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { buildTurnSegment, parseHash } from './utils/sessionRouting'

const SessionRoutingContext = createContext(null)

/**
 * Pure context - reads the hash, exposes state + navigation. No API calls or side effects
 * (that's SessionRoutingEffect's job).
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 */
export function SessionRoutingProvider({ children }) {
  const [routeState, setRouteState] = useState(() => parseHash(window.location.hash))

  // Listen for hash changes (back/forward, manual hash edits)
  useEffect(() => {
    const handleHashChange = () => {
      setRouteState(parseHash(window.location.hash))
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const navigateToSession = useCallback((workspaceId, sessionId, options) => {
    const turnSegment = buildTurnSegment(options?.turnId, options?.messageType)
    window.location.hash = `#/workspaces/${workspaceId}/sessions/${sessionId}${turnSegment}`
    // hashchange event fires automatically, updating state
  }, [])

  const navigateToBoard = useCallback(
    (workspaceId, boardId) => {
      // Preserve a per-viewer density preference across board switches.
      const density = routeState?.density === 'terse' ? 'terse' : null
      const suffix = density ? `?density=${density}` : ''
      window.location.hash = `#/workspaces/${workspaceId}/boards/${boardId}${suffix}`
      // hashchange event fires automatically, updating state
    },
    [routeState?.density],
  )

  const navigateToWorkspace = useCallback(id => {
    window.location.hash = `#/workspaces/${id}`
    // hashchange event fires automatically, updating state
  }, [])

  const navigateHome = useCallback(() => {
    // pushState removes the hash cleanly (no bare '#' in URL)
    history.pushState(null, '', window.location.pathname + window.location.search)
    // pushState doesn't fire hashchange, so update state directly
    setRouteState(null)
  }, [])

  /**
   * Clear the active session segment while preserving `/#/workspaces/{id}` - used by the
   * stop-session flow so the welcome screen shows without losing the workspace. Unlike
   * `navigateHome`, which strips the workspace too.
   */
  const clearActiveSession = useCallback(() => {
    const ws = routeState?.workspaceId
    if (!ws) {
      // No workspace in URL - fall back to home.
      history.pushState(null, '', window.location.pathname + window.location.search)
      setRouteState(null)
      return
    }
    const newHash = `#/workspaces/${ws}`
    history.replaceState(null, '', window.location.pathname + window.location.search + newHash)
    setRouteState(parseHash(newHash))
  }, [routeState?.workspaceId])

  /** Strip a link's carried `send` values from the hash once creation has consumed them. */
  const consumeSendMessages = useCallback(() => {
    const ws = routeState?.workspaceId
    if (!ws) {
      return
    }
    const newHash = `#/workspaces/${ws}`
    history.replaceState(null, '', window.location.pathname + window.location.search + newHash)
    setRouteState(parseHash(newHash))
  }, [routeState?.workspaceId])

  const setDensity = useCallback(density => {
    const [hashPath, hashQuery = ''] = window.location.hash.split('?')
    const params = new URLSearchParams(hashQuery)
    if (density === 'terse') {
      params.set('density', 'terse')
    } else {
      params.delete('density')
    }
    const qs = params.toString()
    const newHash = qs ? `${hashPath}?${qs}` : hashPath
    // replaceState avoids polluting history when toggling density; it doesn't fire hashchange,
    // so state is updated manually.
    history.replaceState(null, '', window.location.pathname + window.location.search + newHash)
    setRouteState(parseHash(newHash))
  }, [])

  const replaceTurnInUrl = useCallback((turnId, messageType) => {
    // Reads the hash live (not routeState) so the callback identity stays stable and the
    // throttled scroll listener doesn't rebind.
    const parsed = parseHash(window.location.hash)
    if (!(parsed?.workspaceId && parsed?.sessionId)) {
      return
    }
    const turnSegment = buildTurnSegment(turnId, messageType)
    const queryStr = window.location.hash.includes('?')
      ? `?${window.location.hash.split('?')[1]}`
      : ''
    const newHash = `#/workspaces/${parsed.workspaceId}/sessions/${parsed.sessionId}${turnSegment}${queryStr}`
    if (newHash === window.location.hash) {
      return
    }
    // replaceState keeps back/forward history clean; no hashchange fires.
    history.replaceState(null, '', window.location.pathname + window.location.search + newHash)
    setRouteState(parseHash(newHash))
  }, [])

  const value = useMemo(
    () => ({
      activeWorkspaceId: routeState?.workspaceId ?? null,
      activeSessionId: routeState?.sessionId ?? null,
      activeBoardId: routeState?.boardId ?? null,
      activeTurnId: routeState?.turnId ?? null,
      activeMessageType: routeState?.messageType ?? null,
      density: routeState?.density ?? 'comfortable',
      sendMessages: routeState?.sendMessages ?? [],
      navigateToSession,
      navigateToBoard,
      navigateToWorkspace,
      navigateHome,
      clearActiveSession,
      setDensity,
      replaceTurnInUrl,
      consumeSendMessages,
    }),
    [
      routeState,
      navigateToSession,
      navigateToBoard,
      navigateToWorkspace,
      navigateHome,
      clearActiveSession,
      setDensity,
      replaceTurnInUrl,
      consumeSendMessages,
    ],
  )

  return <SessionRoutingContext.Provider value={value}>{children}</SessionRoutingContext.Provider>
}

/** Access session routing state and navigation. */
export function useSessionRouting() {
  const context = useContext(SessionRoutingContext)
  if (!context) {
    throw new Error('useSessionRouting must be used within SessionRoutingProvider')
  }
  return context
}
