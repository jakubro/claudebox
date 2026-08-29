/** Rewind / fork orchestration for ChatPanel - extracted to keep the panel below the complexity gate. */

import { useCallback, useState } from 'react'
import { forkSession, stopSession } from '../../../api/sessions'
import { openSessionInNewTab } from '../../../utils/navigation'

/**
 * Manage per-turn rewind and control-bar fork flows.
 *
 * Modal state (rewindTurnId, rewindMode) opens only when fork-here would interrupt a streaming
 * response; non-interrupting requests bypass it and execute directly. Control-bar forks track
 * their own spinner flag (`controlBarForking`) so they don't drive per-turn UI.
 *
 * @param {object} args
 * @param {string|null} args.sessionId - Current session id (fork source).
 * @param {string|null} args.workspaceId - Workspace id for routing the forked session.
 * @param {boolean} args.isResponding - True while the agent is mid-turn; gates the confirm modal.
 * @param {function} args.navigateToSession - Router callback for in-tab navigation.
 * @param {function} args.focusChatTab - Returns focus to the chat tab after fork-here.
 * @param {function} args.seedSession - Sessions list seeder used to populate the new session immediately.
 * @param {function} args.setError - Error reporter for fork failures.
 * @param {function} args.startForking - Events-context signal: a fork is in flight.
 * @param {function} args.clearForking - Events-context signal: fork done.
 */
export default function useChatRewindFork({
  sessionId,
  workspaceId,
  isResponding,
  navigateToSession,
  focusChatTab,
  seedSession,
  setError,
  startForking,
  clearForking,
}) {
  const [rewindTurnId, setRewindTurnId] = useState(null)
  const [rewindMode, setRewindMode] = useState(null)
  const [forkingTurnId, setForkingTurnId] = useState(null)
  // ChatControlBar forks pass turnId=null, leaving forkingTurnId untouched, so in-flight
  // control-bar forks are tracked separately here, mirroring RewindSplitButton's per-turn spinner.
  const [controlBarForking, setControlBarForking] = useState(false)

  /**
   * Execute a fork with the given turnId and mode.
   * @param {string|null} turnId
   * @param {string} mode - 'fork-browser-tab' or 'fork-here'.
   * @param {object} [opts]
   * @param {string} [opts.sourceId] - Fork source session; defaults to the current session.
   * @param {string} [opts.parentSessionId] - Overrides the child's recorded parent.
   * @param {boolean} [opts.stopSourceFirst] - Stop the source first, so its tail is not copied
   *   mid-write.
   * @param {string} [opts.failureMessage] - Error text on failure.
   * @returns {Promise<object|null>} The fork response plus `tabOpened`; null on failure.
   */
  const executeFork = useCallback(
    async (
      turnId,
      mode,
      { sourceId, parentSessionId, stopSourceFirst = false, failureMessage = 'Rewind failed' } = {},
    ) => {
      const forkSourceId = sourceId ?? sessionId
      setForkingTurnId(turnId)
      startForking()
      try {
        if (stopSourceFirst) {
          await stopSession(forkSourceId)
        }
        if (mode === 'fork-browser-tab') {
          const data = await forkSession(forkSourceId, turnId, {
            parent_session_id: parentSessionId,
          })
          let tabOpened = true
          if (data?.session_id) {
            seedSession(data)
            if (workspaceId) {
              tabOpened = Boolean(openSessionInNewTab(workspaceId, data.session_id))
            }
          }
          return data ? { ...data, tabOpened } : null
        }
        // fork-here (default) - reuse the live container, replace current view.
        const data = await forkSession(forkSourceId, turnId, { reuse_container: true })
        if (data?.session_id) {
          seedSession(data)
          if (workspaceId) {
            navigateToSession(workspaceId, data.session_id)
          }
        }
        focusChatTab()
        return data
      } catch {
        setError(failureMessage)
        return null
      } finally {
        setForkingTurnId(null)
        clearForking()
      }
    },
    [
      sessionId,
      workspaceId,
      navigateToSession,
      focusChatTab,
      setError,
      startForking,
      clearForking,
      seedSession,
    ],
  )

  /** Handle rewind request from a turn - show modal only when fork-here while agent is working. */
  const handleRewindRequest = useCallback(
    (turnId, mode = 'fork-here') => {
      if (mode === 'fork-here' && isResponding) {
        setRewindTurnId(turnId)
        setRewindMode(mode)
      } else {
        executeFork(turnId, mode)
      }
    },
    [isResponding, executeFork],
  )

  /** Handle fork request from control bar - show modal only when fork-here while agent is working. */
  const handleForkRequest = useCallback(
    async (mode = 'fork-here') => {
      const turnId = null
      if (mode === 'fork-here' && isResponding) {
        setRewindTurnId('__all__')
        setRewindMode(mode)
        return
      }
      setControlBarForking(true)
      try {
        await executeFork(turnId, mode)
      } finally {
        setControlBarForking(false)
      }
    },
    [isResponding, executeFork],
  )

  /** Confirm fork from the modal. */
  const handleRewindConfirm = useCallback(async () => {
    if (rewindTurnId == null) {
      return
    }
    const isControlBarFork = rewindTurnId === '__all__'
    const turnId = isControlBarFork ? null : rewindTurnId
    if (isControlBarFork) {
      setControlBarForking(true)
    }
    try {
      await executeFork(turnId, rewindMode)
    } finally {
      if (isControlBarFork) {
        setControlBarForking(false)
      }
    }
    setRewindTurnId(null)
    setRewindMode(null)
  }, [rewindTurnId, rewindMode, executeFork])

  /** Close the rewind modal without forking. */
  const closeRewindModal = useCallback(() => {
    setRewindTurnId(null)
    setRewindMode(null)
  }, [])

  return {
    rewindTurnId,
    rewindMode,
    forkingTurnId,
    controlBarForking,
    handleRewindRequest,
    handleForkRequest,
    handleRewindConfirm,
    closeRewindModal,
    executeFork,
  }
}
