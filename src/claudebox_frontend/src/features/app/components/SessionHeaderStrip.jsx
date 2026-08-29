/** Session header strip - chrome of the main panel slot, replacing the chat-group tab bar in-place. */

import { Loader2, Square } from 'lucide-react'
import { useCallback, useState } from 'react'
import { deleteContainer } from '../../../api/containers'
import ConfirmStopModal from '../../../components/ConfirmStopModal.jsx'
import NewSessionSplitButton from '../../../components/NewSessionSplitButton'
import { useAppActions } from '../../../context/AppActionsContext'
import { useContainerMap } from '../../../context/ContainerMapContext'
import { useEvents } from '../../../context/EventsContext'
import { useSessionData, useSessionDir } from '../../../context/SessionDataContext'
import { useSessionRouting } from '../../../context/SessionRoutingContext'
import { useSessionsList } from '../../../context/SessionsContext'
import { useWorkspace } from '../../../context/WorkspaceContext'
import useCopyFlash from '../../../hooks/useCopyFlash'
import { formatSessionDirTooltip } from '../../../utils/session'
import useSessionRail from '../../chat/hooks/useSessionRail'
import BoardHeaderInfo from './BoardHeaderInfo'
import WorkspaceSwitcher from './WorkspaceSwitcher'

/**
 * Session header strip - the rail path on the left, NewSessionSplitButton and WorkspaceSwitcher on
 * the right, nothing on the left in welcome state.
 *
 * Every group has an entry here whatever the rail renders, so this reaches one scrolled off or
 * collapsed past the depth cap - and it is the only place an ancestor can be stopped.
 *
 * @param {object} [props]
 * @param {object} [props.panelApi] - Dockview panel API from MainPanel; its double-click handler calls
 *   maximizeToggle on the panel's group. Read at call-time (`panelApi?.group?.api`) for drag/drop re-host.
 */
export default function SessionHeaderStrip({ panelApi }) {
  const { sessionName } = useSessionData()
  const sessionDir = useSessionDir()
  const { isResponding, isCreating, closeSSE, clearCreating } = useEvents()
  const { containerMap, addStoppingSession, deriveSessionStatus } = useContainerMap()
  const { sessions, refresh } = useSessionsList()
  const { activeBoardId, activeWorkspaceId, clearActiveSession, navigateToSession } =
    useSessionRouting()
  const { workspaceId } = useWorkspace()
  const { maximizeToggle } = useAppActions()
  const { chain, focusedSessionId } = useSessionRail()
  const [copied, copy] = useCopyFlash()

  // Session id awaiting stop confirmation - null when nothing is pending. One entry can be
  // pending at a time; opening a second path entry's confirm implicitly cancels the first.
  const [pendingStopSessionId, setPendingStopSessionId] = useState(null)

  const isWelcome = !(focusedSessionId || isCreating)
  // Board view = URL targets a board and the workspace context has caught up; mirrors MainPanel's guard
  // so the LEFT slot doesn't flash a stale pill while workspaces switch.
  const isBoardView = activeBoardId && (!activeWorkspaceId || activeWorkspaceId === workspaceId)

  const sessionsById = new Map(sessions.map(s => [s.session_id, s]))

  const stopEntry = useCallback(
    (entrySessionId, entryContainerId) => {
      addStoppingSession(entrySessionId)
      // Keep the containerMap mapping until the daemon's "stopped" event clears it - dropping it
      // here wedges "stopping". The synchronous teardown runs before the fire-and-forget delete.
      if (entrySessionId === focusedSessionId) {
        closeSSE?.()
        // The group it descended from takes focus, as walking back would; the root has no parent,
        // so stopping it is the one case that clears to welcome.
        const parentSessionId = chain.length > 1 ? chain[chain.length - 2] : null
        if (parentSessionId && workspaceId) {
          navigateToSession(workspaceId, parentSessionId)
        } else {
          clearActiveSession?.()
        }
        if (isCreating) {
          clearCreating?.()
        }
      }
      deleteContainer(entryContainerId).catch(err =>
        console.debug('SessionHeaderStrip: deleteContainer failed', err),
      )
      refresh()
    },
    [
      addStoppingSession,
      focusedSessionId,
      chain,
      workspaceId,
      navigateToSession,
      closeSSE,
      clearActiveSession,
      isCreating,
      clearCreating,
      refresh,
    ],
  )

  // The focused entry's live isResponding is known, so it skips the confirm step when idle. An
  // ancestor's is not observable here, so it always confirms.
  const handleStopClick = useCallback(
    (entrySessionId, entryContainerId) => {
      if (entrySessionId === focusedSessionId && !isResponding) {
        stopEntry(entrySessionId, entryContainerId)
        return
      }
      setPendingStopSessionId(entrySessionId)
    },
    [focusedSessionId, isResponding, stopEntry],
  )

  const handleNameClick = useCallback(() => {
    if (sessionDir) {
      copy(sessionDir)
    }
  }, [sessionDir, copy])

  // Double-click on the strip's non-interactive area toggles the main panel's maximize state (mirrors
  // dockview tab dblclick behavior). The closest('button, a, input, [role="button"]') guard skips
  // clicks on Stop, +/chevron, a path entry or the workspace switcher; the status dot still does.
  const handleDoubleClick = useCallback(
    e => {
      if (e.target.closest('button, a, input, [role="button"]')) {
        return
      }
      const groupApi = panelApi?.group?.api
      if (groupApi) {
        maximizeToggle?.(groupApi)
      }
    },
    [panelApi, maximizeToggle],
  )

  return (
    <div
      className="session-header-strip"
      data-testid="session-header-strip"
      onDoubleClick={handleDoubleClick}>
      <div className="session-header-strip-left">
        {isBoardView ? (
          <BoardHeaderInfo boardId={activeBoardId} />
        ) : isWelcome ? null : isCreating ? (
          // Supersedes whatever chain would otherwise show: mid-creation the chain still names the
          // old session or an unregistered new one, so isCreating alone decides.
          <>
            <Loader2 size={10} className="spin session-header-strip-spinner" />
            <span className="session-header-strip-name session-header-strip-name-creating">
              Creating…
            </span>
          </>
        ) : (
          <div className="session-header-path" data-testid="session-header-path">
            {chain.map(entrySessionId => {
              const entrySession = sessionsById.get(entrySessionId)
              const entryContainerId =
                containerMap[entrySessionId] ?? entrySession?.container_id ?? null
              const entryHasContainer = entryContainerId != null
              // A side thread's container_id (when live) is its parent's - stopping it by
              // container would take the whole shared group down, so it gets no Stop of its own.
              const entryCanStop = entryHasContainer && !entrySession?.is_side_thread
              const entryStatus = deriveSessionStatus(entrySessionId, sessions)
              const entryIsStopping = entryStatus === 'stopping'
              const entryIsFocused = entrySessionId === focusedSessionId
              // The focused entry prefers SessionDataContext's sessionName, fresher than the
              // sessions list right after a rename; an ancestor has only the list.
              const entryName =
                (entryIsFocused && sessionName) || entrySession?.name || entrySessionId.slice(0, 8)

              return (
                <div
                  key={entrySessionId}
                  className={`session-header-path-entry${entryIsFocused ? ' focused' : ''}`}
                  data-testid="session-header-path-entry"
                  data-session-id={entrySessionId}
                  data-focused={entryIsFocused}>
                  <span
                    className={`container-status-dot container-status-${entryStatus}`}
                    title={
                      entryIsStopping
                        ? 'Stopping container…'
                        : entryHasContainer
                          ? 'Container running'
                          : 'No container'
                    }
                    data-testid="session-header-status-dot"
                    data-status={entryStatus}
                  />
                  <button
                    type="button"
                    className="session-header-strip-name"
                    onClick={() =>
                      entryIsFocused
                        ? handleNameClick()
                        : navigateToSession(workspaceId, entrySessionId)
                    }
                    title={entryIsFocused ? formatSessionDirTooltip(sessionDir) : entryName}
                    data-testid="session-header-session-name">
                    <span style={{ visibility: entryIsFocused && copied ? 'hidden' : 'visible' }}>
                      {entryName}
                    </span>
                    {entryIsFocused && copied && (
                      <span className="session-header-strip-name-copied">Copied!</span>
                    )}
                  </button>
                  {entryCanStop && (
                    <button
                      type="button"
                      className="session-header-strip-stop"
                      onClick={() => handleStopClick(entrySessionId, entryContainerId)}
                      title="Stop session"
                      data-testid="session-header-stop-btn">
                      <Square size={11} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div className="session-header-strip-right">
        <NewSessionSplitButton dropdownPlacement="portal" dataTestIdPrefix="header" />
        <WorkspaceSwitcher />
      </div>
      {pendingStopSessionId &&
        (() => {
          const entrySession = sessionsById.get(pendingStopSessionId)
          const entryContainerId =
            containerMap[pendingStopSessionId] ?? entrySession?.container_id ?? null

          return (
            <ConfirmStopModal
              variant="stop"
              onConfirm={() => {
                setPendingStopSessionId(null)
                stopEntry(pendingStopSessionId, entryContainerId)
              }}
              onCancel={() => setPendingStopSessionId(null)}
            />
          )
        })()}
    </div>
  )
}
