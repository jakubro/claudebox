/** Session header strip — chrome of the main panel slot, replacing the chat-group tab bar in-place. */

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
import BoardHeaderInfo from './BoardHeaderInfo'
import WorkspaceSwitcher from './WorkspaceSwitcher'

/**
 * Render the session header strip — status dot, session name + Stop button on the left;
 * NewSessionSplitButton + WorkspaceSwitcher on the right. LEFT slot is empty in welcome
 * state. Reads most things from context.
 *
 * @param {object} [props]
 * @param {object} [props.panelApi] - Dockview panel API plumbed from MainPanel; used by
 *   the strip's double-click handler to call maximizeToggle on the panel's group. Reading
 *   `panelApi?.group?.api` at call-time keeps drag/drop re-host robust.
 */
export default function SessionHeaderStrip({ panelApi }) {
  const { sessionId, sessionName } = useSessionData()
  const sessionDir = useSessionDir()
  const { isResponding, isCreating, containerId, closeSSE, clearCreating } = useEvents()
  const { containerMap, addStoppingSession, deriveSessionStatus } = useContainerMap()
  const { sessions, refresh } = useSessionsList()
  const { activeSessionId, activeBoardId, activeWorkspaceId, clearActiveSession } =
    useSessionRouting()
  const { workspaceId } = useWorkspace()
  const { maximizeToggle } = useAppActions()
  const [copied, copy] = useCopyFlash()

  const [pendingStop, setPendingStop] = useState(false)

  // Active session = whatever the URL says, falling back to the SessionDataContext value.
  const effectiveSessionId = activeSessionId ?? sessionId
  const isWelcome = !(effectiveSessionId || isCreating)
  // Board view = URL targets a board AND the workspace context has caught up
  // (or no workspace mismatch). Mirrors MainPanel's guard so the LEFT slot
  // doesn't flash a stale pill while the workspace switches.
  const isBoardView = activeBoardId && (!activeWorkspaceId || activeWorkspaceId === workspaceId)

  // Container state: prefer eager container map, fall back to the sessions-list copy.
  const sessionData = sessions.find(s => s.session_id === effectiveSessionId)
  const effectiveContainerId =
    containerMap[effectiveSessionId] ?? sessionData?.container_id ?? containerId ?? null
  const hasContainer = effectiveContainerId != null
  // Route the dot through the shared derivation (containerMap + sessions only,
  // like the panel/bookmark dots) so the surfaces can't diverge. The
  // EventsContext containerId is deliberately NOT a status source: it lingers
  // after a panel-initiated stop and kept this dot "running" while the others
  // cleared. The stop button still uses effectiveContainerId (hasContainer).
  const status = effectiveSessionId ? deriveSessionStatus(effectiveSessionId, sessions) : 'none'
  const isStopping = status === 'stopping'
  const statusClass = `container-status-${status}`

  const stopContainer = useCallback(() => {
    if (!(effectiveContainerId && effectiveSessionId)) {
      return
    }
    addStoppingSession(effectiveSessionId)
    // Keep the containerMap mapping until the daemon's terminal `stopped` event
    // clears it (ContainerStatusEffect) — dropping it here wedges "stopping".
    // Synchronously null EventsContext.containerId, clear activeSessionId,
    // and clear stuck creating overlay so the `isWelcome` derivation flips
    // in one React batch. closeSSE + clearActiveSession run before the
    // fire-and-forget deleteContainer so the UI transitions independently
    // of the network round-trip.
    closeSSE?.()
    clearActiveSession?.()
    if (isCreating) {
      clearCreating?.()
    }
    deleteContainer(effectiveContainerId).catch(err =>
      console.debug('SessionHeaderStrip: deleteContainer failed', err),
    )
    refresh()
  }, [
    effectiveContainerId,
    effectiveSessionId,
    isCreating,
    addStoppingSession,
    closeSSE,
    clearActiveSession,
    clearCreating,
    refresh,
  ])

  const handleStopClick = useCallback(() => {
    if (isResponding) {
      setPendingStop(true)
      return
    }
    stopContainer()
  }, [isResponding, stopContainer])

  const handleStopConfirm = useCallback(() => {
    setPendingStop(false)
    stopContainer()
  }, [stopContainer])

  const handleStopCancel = useCallback(() => {
    setPendingStop(false)
  }, [])

  const handleNameClick = useCallback(() => {
    if (sessionDir) {
      copy(sessionDir)
    }
  }, [sessionDir, copy])

  const nameTooltip = formatSessionDirTooltip(sessionDir)
  const nameLabel = sessionName || effectiveSessionId?.slice(0, 8) || ''

  // Double-click on the strip's non-interactive area toggles the main panel's
  // maximize state (mirrors dockview tab dblclick behavior). The closest('button,
  // a, input, [role="button"]') guard skips clicks on Stop / +/chevron / session
  // name / workspace switcher; the decorative status dot still triggers maximize.
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
          <>
            <Loader2 size={10} className="spin session-header-strip-spinner" />
            <span className="session-header-strip-name session-header-strip-name-creating">
              Creating…
            </span>
          </>
        ) : (
          <>
            <span
              className={`container-status-dot ${statusClass}`}
              title={
                isStopping
                  ? 'Stopping container…'
                  : hasContainer
                    ? 'Container running'
                    : 'No container'
              }
              data-testid="session-header-status-dot"
              data-status={statusClass.replace('container-status-', '')}
            />
            <button
              type="button"
              className="session-header-strip-name"
              onClick={handleNameClick}
              title={nameTooltip}
              data-testid="session-header-session-name">
              <span style={{ visibility: copied ? 'hidden' : 'visible' }}>{nameLabel}</span>
              {copied && <span className="session-header-strip-name-copied">Copied!</span>}
            </button>
            {hasContainer && (
              <button
                type="button"
                className="session-header-strip-stop"
                onClick={handleStopClick}
                title="Stop session"
                data-testid="session-header-stop-btn">
                <Square size={11} />
              </button>
            )}
          </>
        )}
      </div>
      <div className="session-header-strip-right">
        <NewSessionSplitButton dropdownPlacement="portal" dataTestIdPrefix="header" />
        <WorkspaceSwitcher />
      </div>
      {pendingStop && (
        <ConfirmStopModal
          variant="stop"
          onConfirm={handleStopConfirm}
          onCancel={handleStopCancel}
        />
      )}
    </div>
  )
}
