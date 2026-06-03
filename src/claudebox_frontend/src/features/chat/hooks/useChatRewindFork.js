/** Rewind / fork orchestration for ChatPanel — extracted to keep the panel below the complexity gate. */

import { useCallback, useState } from 'react'
import { forkSession } from '../../../api/sessions'
import { openSessionInNewTab } from '../../../utils/navigation'

/**
 * Manage per-turn rewind and control-bar fork flows.
 *
 * Modal state (rewindTurnId, rewindMode) opens only when fork-here would
 * interrupt a streaming response; non-interrupting requests bypass the modal
 * and execute directly. Control-bar forks are tracked with their own spinner
 * flag (`controlBarForking`) so they don't drive per-turn UI.
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
  // Control-bar fork is independent of per-turn rewind: forks initiated from
  // ChatControlBar pass turnId=null, which leaves forkingTurnId untouched.
  // Track in-flight control-bar forks separately so the control bar's spinner
  // mirrors the per-turn RewindSplitButton UX.
  const [controlBarForking, setControlBarForking] = useState(false)

  /** Execute a fork with the given turnId and mode. */
  const executeFork = useCallback(
    async (turnId, mode) => {
      setForkingTurnId(turnId)
      startForking()
      try {
        if (mode === 'fork-browser-tab') {
          const data = await forkSession(sessionId, turnId)
          if (data?.session_id) {
            seedSession(data)
            if (workspaceId) {
              openSessionInNewTab(workspaceId, data.session_id)
            }
          }
        } else {
          // fork-here (default) — reuse the live container, replace current view.
          const data = await forkSession(sessionId, turnId, { reuse_container: true })
          if (data?.session_id) {
            seedSession(data)
            if (workspaceId) {
              navigateToSession(workspaceId, data.session_id)
            }
          }
          focusChatTab()
        }
      } catch {
        setError('Rewind failed')
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

  /** Handle rewind request from a turn — show modal only when fork-here while agent is working. */
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

  /** Handle fork request from control bar — show modal only when fork-here while agent is working. */
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
  }
}
