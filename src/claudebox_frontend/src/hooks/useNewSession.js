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
 * Return an `executeNewSession` callback that creates a session in the
 * background while the SessionHeaderStrip's "Creating…" indicator (driven by
 * EventsContext.isCreating) covers the loading state. On success, sets the
 * container ID, seeds the session data, and navigates to the new session.
 *
 * Resolves to `true` on success, `false` on failure.
 *
 * @returns {{ executeNewSession: () => Promise<boolean>, executeNewSessionInNewTab: () => Promise<void>, isCreating: boolean, isCreatingInNewTab: boolean }}
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

  const executeNewSession = useCallback(async () => {
    // Prevent concurrent creation attempts
    if (creatingRef.current) {
      return false
    }
    creatingRef.current = true
    clearProgress()

    // Snapshot the prior session so the still-running toast can offer a
    // return jump if Claude was responding when the user replaced it.
    const prevSessionId = currentSessionId
    const prevSessionName = currentSessionName
    const prevWasResponding = isResponding

    // Abort any previous in-flight request
    abortRef.current?.abort()
    const abortController = new AbortController()
    abortRef.current = abortController

    // Pre-call: drop stale sessionData. The create-response carries the full
    // synthesized SessionInfo (workspace, session_dir, effort_level default,
    // zeros for turn/cost stats), so we seed it post-call rather than reading
    // stale fields from the previous session here.
    clearSessionData()
    startCreating()
    focusChatTab()

    try {
      const data = await newSession({ signal: abortController.signal })

      if (data?.session_id) {
        // Seed the full SessionInfo response - populates the footer
        // immediately (workspace, session_dir, effort_level, zeros).
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
      return true
    } catch (err) {
      if (err?.name === 'AbortError') {
        return false
      }
      clearCreating()
      setError('New session failed')
      return false
    } finally {
      creatingRef.current = false
    }
  }, [
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
    currentSessionId,
    currentSessionName,
    isResponding,
    showStillRunningToast,
  ])

  const cancelCreation = useCallback(() => {
    abortRef.current?.abort()
    clearCreating()
    creatingRef.current = false
  }, [clearCreating])

  const [isCreatingInNewTab, setIsCreatingInNewTab] = useState(false)

  // Opening a session in a new browser tab must not toggle the originating
  // tab's global EventsContext lifecycle flags - the new tab manages its own
  // creating/resuming state when it loads. Local `isCreatingInNewTab` is
  // sufficient to drive the trigger button's spinner.
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
    executeNewSessionInNewTab,
    cancelCreation,
    isCreating,
    isCreatingInNewTab,
  }
}
