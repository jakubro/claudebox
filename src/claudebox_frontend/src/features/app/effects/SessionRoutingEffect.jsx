/** Bridge between URL routing and session lifecycle. */

import { useCallback, useEffect, useRef } from 'react'
import { setContainerId } from '../../../api/apiClient'
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
 * Reacts to activeSessionId from SessionRoutingContext: non-null resumes the session (POST
 * /sessions/{id}/resume, sets container ID, reconnects SSE); null clears session data/stash and
 * disconnects SSE. Also switches the active workspace when the URL targets a board in a different
 * workspace. A sequence counter guards rapid-switch races - only the response matching the
 * current activeSessionId is honored.
 */
export default function SessionRoutingEffect() {
  const { activeSessionId, activeBoardId, activeWorkspaceId, navigateHome } = useSessionRouting()
  const { workspaceId, selectWorkspace } = useWorkspace()
  const { setSessionContainer } = useContainerMap()
  const {
    reconnectSSE,
    disconnectSSE,
    startResume,
    clearResume,
    notifyContainerChanged,
    consumeJustCreatedSession,
  } = useEvents()
  const { clearProgress } = useDaemonStreamContext()
  const { clearSessionData } = useSessionActions()
  const { clearStash } = useStash()
  const { setError } = useInteraction()

  const sequenceRef = useRef(0)
  const prevSessionIdRef = useRef(null)

  const handleResume = useCallback(
    async (sessionId, seq) => {
      clearProgress()
      startResume()
      try {
        const data = await resumeSession(sessionId)
        // Guard: ignore stale responses from rapid switching
        if (sequenceRef.current !== seq) {
          return
        }
        if (data?.container_id) {
          setContainerId(data.container_id)
          notifyContainerChanged()
          setSessionContainer(sessionId, data.container_id)
        }
        clearSessionData()
        clearStash()
        reconnectSSE({ skipClear: true })
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
      clearResume,
      notifyContainerChanged,
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
      // Navigated home - clear everything, disconnect without reconnect
      clearSessionData()
      clearStash()
      disconnectSSE()
      return
    }

    // Deep link to different workspace - switch workspace first
    if (activeWorkspaceId && activeWorkspaceId !== workspaceId) {
      selectWorkspace(activeWorkspaceId)
    }

    // Skip resume for a session this tab just created - useNewSession already set up the
    // container, and SSE connects naturally via the container ID change.
    if (consumeJustCreatedSession(activeSessionId)) {
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
    disconnectSSE,
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
