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
 * Bridge between URL routing and session lifecycle.
 *
 * Reacts to activeSessionId changes from SessionRoutingContext:
 * - Non-null: calls POST /sessions/{id}/resume, sets container ID, reconnects SSE.
 * - Null: clears session data, stash, disconnects SSE.
 *
 * Also switches the active workspace when the URL targets a board in a different workspace.
 *
 * Uses a sequence counter to guard against race conditions from rapid session switching.
 * Only honors the response matching the current activeSessionId.
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
    isCreating,
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
    // Skip if session ID hasn't actually changed
    if (activeSessionId === prevSessionIdRef.current) {
      return
    }
    prevSessionIdRef.current = activeSessionId

    const seq = ++sequenceRef.current

    if (!activeSessionId) {
      // Navigated home — clear everything, disconnect without reconnect
      clearSessionData()
      clearStash()
      disconnectSSE()
      return
    }

    // Deep link to different workspace — switch workspace first
    if (activeWorkspaceId && activeWorkspaceId !== workspaceId) {
      selectWorkspace(activeWorkspaceId)
    }

    // Skip resume for just-created sessions — useNewSession already set up the container
    // and SSE will connect naturally via the container ID change.
    if (!isCreating) {
      handleResume(activeSessionId, seq)
    }
  }, [
    activeSessionId,
    activeWorkspaceId,
    workspaceId,
    selectWorkspace,
    handleResume,
    clearSessionData,
    clearStash,
    disconnectSSE,
    isCreating,
  ])

  // Switch workspace when the board URL targets a workspace different from the
  // active one. Otherwise the main panel reads activeBoardId directly from
  // SessionRoutingContext and renders BoardTab without any imperative call here.
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
