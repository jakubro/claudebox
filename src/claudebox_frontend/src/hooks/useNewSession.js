/** Hook encapsulating the create-new-session workflow shared across UI surfaces. */

import { useCallback, useRef, useState } from 'react'
import { setContainerId } from '../api/apiClient'
import { newSession } from '../api/sessions'
import { useAppActions } from '../context/AppActionsContext'
import { useContainerMap } from '../context/ContainerMapContext'
import { useDaemonStreamContext } from '../context/DaemonStreamContext'
import { useEvents } from '../context/EventsContext'
import { useInteraction } from '../context/InteractionContext'
import { useSessionActions, useSessionData } from '../context/SessionDataContext'
import { useSessionRouting } from '../context/SessionRoutingContext'
import { useStillRunningToast } from '../context/StillRunningToastContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { openSessionInNewTab } from '../utils/navigation'

/**
 * Creates a session in the background; SessionHeaderStrip's "Creating..." indicator is driven by
 * EventsContext.isCreating. Resolves `true` on success, `false` on failure.
 */
export default function useNewSession() {
  const { focusChatTab } = useAppActions()
  const { setSessionContainer } = useContainerMap()
  const { setError } = useInteraction()
  const { clearSessionData, seedSessionData } = useSessionActions()
  const {
    notifyContainerChanged,
    reconnectSSE,
    startCreating,
    clearCreating,
    markJustCreatedSession,
    isCreating,
    isResponding,
  } = useEvents()
  const { sessionId: currentSessionId, sessionName: currentSessionName } = useSessionData()
  const { showStillRunningToast } = useStillRunningToast()
  const { clearProgress } = useDaemonStreamContext()
  const { navigateToSession } = useSessionRouting()
  const { workspaceId } = useWorkspace()
  const creatingRef = useRef(false)
  const abortRef = useRef(null)

  const createSession = useCallback(
    async messages => {
      if (creatingRef.current) {
        return { success: false, undeliveredMessages: [] }
      }
      creatingRef.current = true
      clearProgress()

      // Snapshot the prior session so the still-running toast can offer a return jump.
      const prevSessionId = currentSessionId
      const prevSessionName = currentSessionName
      const prevWasResponding = isResponding

      abortRef.current?.abort()
      const abortController = new AbortController()
      abortRef.current = abortController

      // Drop stale sessionData now - the create response reseeds a full SessionInfo below:
      // workspace, session_dir, effort_level, zeroed stats.
      clearSessionData()
      startCreating()
      focusChatTab()

      try {
        const data = await newSession({ signal: abortController.signal, messages })

        if (data?.session_id) {
          // Seed the full SessionInfo response so the footer populates immediately.
          seedSessionData(data)
        }
        if (data?.container_id) {
          setContainerId(data.container_id)
          notifyContainerChanged()
          reconnectSSE()
          if (data.session_id) {
            setSessionContainer(data.session_id, data.container_id)
          }
        }
        if (data?.session_id && workspaceId) {
          // Set before navigating - SessionRoutingEffect must see it on its first reaction to the id.
          markJustCreatedSession(data.session_id)
          navigateToSession(workspaceId, data.session_id)
          if (prevWasResponding && prevSessionId && prevSessionId !== data.session_id) {
            showStillRunningToast({
              sessionName: prevSessionName || prevSessionId.slice(0, 8),
              onReturn: () => navigateToSession(workspaceId, prevSessionId),
            })
          }
        }
        // Don't clearCreating() here - ChatPanel effect clears when SSE connects
        focusChatTab()
        return { success: true, undeliveredMessages: data?.undelivered_messages ?? [] }
      } catch (err) {
        if (err?.name === 'AbortError') {
          return { success: false, undeliveredMessages: [] }
        }
        clearCreating()
        setError('New session failed')
        return { success: false, undeliveredMessages: [] }
      } finally {
        creatingRef.current = false
      }
    },
    [
      clearProgress,
      clearSessionData,
      seedSessionData,
      notifyContainerChanged,
      reconnectSSE,
      navigateToSession,
      workspaceId,
      focusChatTab,
      setError,
      setSessionContainer,
      startCreating,
      clearCreating,
      markJustCreatedSession,
      currentSessionId,
      currentSessionName,
      isResponding,
      showStillRunningToast,
    ],
  )

  const executeNewSession = useCallback(async () => {
    const { success } = await createSession()
    return success
  }, [createSession])

  /** Create a session from a link's carried messages; returns which ones the allowlist blocked. */
  const executeNewSessionFromLink = useCallback(
    messages => createSession(messages),
    [createSession],
  )

  const cancelCreation = useCallback(() => {
    abortRef.current?.abort()
    clearCreating()
    creatingRef.current = false
  }, [clearCreating])

  const [isCreatingInNewTab, setIsCreatingInNewTab] = useState(false)

  // Must not toggle origin tab's global EventsContext flags - `isCreatingInNewTab` drives only this spinner.
  const executeNewSessionInNewTab = useCallback(async () => {
    setIsCreatingInNewTab(true)
    try {
      const data = await newSession()
      if (data?.session_id && workspaceId) {
        openSessionInNewTab(workspaceId, data.session_id)
      }
    } catch {
      setError('New session failed')
    } finally {
      setIsCreatingInNewTab(false)
    }
  }, [workspaceId, setError])

  return {
    executeNewSession,
    executeNewSessionFromLink,
    executeNewSessionInNewTab,
    cancelCreation,
    isCreating,
    isCreatingInNewTab,
  }
}
