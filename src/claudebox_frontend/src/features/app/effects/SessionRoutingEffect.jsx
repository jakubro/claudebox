/** Bridge between URL routing and session lifecycle. */

import { useCallback, useEffect, useRef } from 'react'
import { setAddress } from '../../../api/apiClient'
import { resumeSession } from '../../../api/sessions'
import { useContainerMap } from '../../../context/ContainerMapContext'
import { useDaemonStreamContext } from '../../../context/DaemonStreamContext'
import { useEvents } from '../../../context/EventsContext'
import { useInteraction } from '../../../context/InteractionContext'
import { useSessionActions } from '../../../context/SessionDataContext'
import { useSessionRouting } from '../../../context/SessionRoutingContext'
import { useStash } from '../../../context/StashContext'
import { useWorkspace } from '../../../context/WorkspaceContext'

/**
 * Resume the routed session (container id, SSE), or with none routed release the one left; switch
 * workspace for a link into another, and honour only the resume matching the current route.
 */
export default function SessionRoutingEffect() {
  const { activeSessionId, activeBoardId, activeWorkspaceId, navigateHome } = useSessionRouting()
  const { workspaceId, selectWorkspace } = useWorkspace()
  const { setSessionContainer } = useContainerMap()
  const {
    reconnectSSE,
    closeSSE,
    startResume,
    settleResumeRequest,
    clearResume,
    notifyAddressChanged,
    consumeJustCreatedSession,
  } = useEvents()
  const { clearProgress } = useDaemonStreamContext()
  const { clearSessionData } = useSessionActions()
  const { clearStash } = useStash()
  const { setError } = useInteraction()

  const sequenceRef = useRef(0)
  // audit-ignore: session-transition-guard - tracks the route, which never passes through empty
  const prevSessionIdRef = useRef(null)

  const handleResume = useCallback(
    async (sessionId, seq) => {
      clearProgress()
      const token = startResume()
      try {
        const data = await resumeSession(sessionId)
        // Guard: ignore stale responses from rapid switching
        if (sequenceRef.current !== seq) {
          return
        }
        if (data?.container_id) {
          setAddress(data.container_id, sessionId)
          notifyAddressChanged()
          setSessionContainer(sessionId, data.container_id)
        }
        clearSessionData()
        clearStash()
        // Same synchronous block as the reconnect: the reset drops the previous stream's drain, so
        // no REPLAY_ENDED of the session left can end "Resuming" once the request has settled.
        settleResumeRequest(token)
        reconnectSSE()
      } catch {
        if (sequenceRef.current !== seq) {
          return
        }
        clearResume()
        setError('Session not found')
        navigateHome()
      }
    },
    [
      clearProgress,
      startResume,
      settleResumeRequest,
      clearResume,
      notifyAddressChanged,
      setSessionContainer,
      clearSessionData,
      clearStash,
      reconnectSSE,
      setError,
      navigateHome,
    ],
  )

  useEffect(() => {
    if (activeSessionId === prevSessionIdRef.current) {
      return
    }
    prevSessionIdRef.current = activeSessionId

    const seq = ++sequenceRef.current

    if (!activeSessionId) {
      // No session routed - let go of the one left: its container id, streams and data.
      clearResume()
      clearSessionData()
      clearStash()
      closeSSE()
      return
    }

    // Deep link to different workspace - switch workspace first
    if (activeWorkspaceId && activeWorkspaceId !== workspaceId) {
      selectWorkspace(activeWorkspaceId)
    }

    // Skip resume for a session this tab just created - useNewSession already set up the
    // container, and SSE connects naturally via the container ID change.
    if (consumeJustCreatedSession(activeSessionId)) {
      clearResume()
      return
    }

    handleResume(activeSessionId, seq)
  }, [
    activeSessionId,
    activeWorkspaceId,
    workspaceId,
    selectWorkspace,
    handleResume,
    clearSessionData,
    clearStash,
    closeSSE,
    clearResume,
    consumeJustCreatedSession,
  ])

  // Switch workspace when the board URL targets a workspace different from the active one -
  // otherwise MainPanel reads activeBoardId directly and renders BoardTab with no imperative call here.
  useEffect(() => {
    if (!activeBoardId) {
      return
    }
    if (activeWorkspaceId && activeWorkspaceId !== workspaceId && workspaceId !== null) {
      selectWorkspace(activeWorkspaceId)
    }
  }, [activeBoardId, activeWorkspaceId, workspaceId, selectWorkspace])

  return null
}
