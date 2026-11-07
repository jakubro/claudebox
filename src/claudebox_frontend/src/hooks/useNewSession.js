/** Hook encapsulating the create-new-session workflow shared across UI surfaces. */

import { useCallback, useRef, useState } from 'react'
import { setAddress } from '../api/apiClient'
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
  const { clearSessionData, seedSessionData, refreshSession } = useSessionActions()
  const {
    notifyAddressChanged,
    reconnectSSE,
    startCreating,
    settleCreateRequest,
    failCreating,
    markJustCreatedSession,
    isCreating,
    isResponding,
  } = useEvents()
  const {
    sessionData: currentSessionData,
    sessionId: currentSessionId,
    sessionName: currentSessionName,
    deferredBundle,
  } = useSessionData()
  const { showStillRunningToast } = useStillRunningToast()
  const { clearProgress } = useDaemonStreamContext()
  const { navigateToSession, activeSessionId } = useSessionRouting()
  const { workspaceId } = useWorkspace()
  const creatingRef = useRef(false)
  const abortRef = useRef(null)
  const creationSeqRef = useRef(null)

  const createSession = useCallback(
    async (messages, bundle) => {
      if (creatingRef.current) {
        return { success: false, undeliveredMessages: [] }
      }
      creatingRef.current = true
      clearProgress()

      // Snapshot the prior session so the still-running toast can offer a return jump.
      const prevSessionId = currentSessionId
      const prevSessionName = currentSessionName
      const prevWasResponding = isResponding
      const prevSessionData = currentSessionData

      abortRef.current?.abort()
      const abortController = new AbortController()
      abortRef.current = abortController

      // Drop stale sessionData now - the create response reseeds a full SessionInfo below:
      // workspace, session_dir, effort_level, zeroed stats.
      clearSessionData()
      const seq = startCreating(activeSessionId ?? null, messages ?? [])
      creationSeqRef.current = seq
      focusChatTab()

      try {
        const data = await newSession({
          signal: abortController.signal,
          messages,
          bundle: bundle ?? deferredBundle ?? undefined,
        })
        settleCreateRequest(seq, data?.session_id ?? null, {
          undeliveredMessages: data?.undelivered_messages ?? [],
          bundleMessages: data?.bundle_messages ?? [],
        })

        if (data?.session_id) {
          // Seed the full SessionInfo response so the footer populates immediately.
          seedSessionData(data)
        }
        if (data?.container_id) {
          setAddress(data.container_id, data.session_id)
          notifyAddressChanged()
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
        // "Creating" stays up until useChatCreatingClear sees the new session's stream connect.
        focusChatTab()
        return { success: true, undeliveredMessages: data?.undelivered_messages ?? [] }
      } catch (err) {
        failCreating(seq)
        if (err?.name === 'AbortError') {
          return { success: false, undeliveredMessages: [] }
        }
        // The tab still addresses the session left; it is back on screen at once, then confirmed.
        if (prevSessionData?.session_id) {
          seedSessionData(prevSessionData)
          void refreshSession()
        }
        setError(err?.userFacing ? err.message : 'New session failed')
        return { success: false, undeliveredMessages: [] }
      } finally {
        creatingRef.current = false
      }
    },
    [
      clearProgress,
      clearSessionData,
      seedSessionData,
      notifyAddressChanged,
      reconnectSSE,
      navigateToSession,
      workspaceId,
      focusChatTab,
      setError,
      setSessionContainer,
      startCreating,
      settleCreateRequest,
      failCreating,
      activeSessionId,
      markJustCreatedSession,
      currentSessionData,
      currentSessionId,
      currentSessionName,
      deferredBundle,
      refreshSession,
      isResponding,
      showStillRunningToast,
    ],
  )

  /** Create a session in this tab, under `bundle` when one is named, else under the welcome pick. */
  const executeNewSession = useCallback(
    async bundle => {
      const { success } = await createSession(undefined, bundle)
      return success
    },
    [createSession],
  )

  /** Create a session from a link's carried messages; returns which ones the allowlist blocked. */
  const executeNewSessionFromLink = useCallback(
    messages => createSession(messages.filter(message => message.trim())),
    [createSession],
  )

  const cancelCreation = useCallback(() => {
    abortRef.current?.abort()
    if (creationSeqRef.current !== null) {
      failCreating(creationSeqRef.current)
    }
    creatingRef.current = false
  }, [failCreating])

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
