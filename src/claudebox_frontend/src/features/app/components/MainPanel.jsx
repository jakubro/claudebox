/** Main panel - single dockview center slot rendering URL-driven content (welcome | chat | board). */

import { useSessionRouting } from '../../../context/SessionRoutingContext'
import { useWorkspace } from '../../../context/WorkspaceContext'
import BoardTab from '../../boards/BoardTab'
import ChatPanel from '../../chat'
import SessionHeaderStrip from './SessionHeaderStrip'

/**
 * `/boards/{boardId}` routes to BoardTab; otherwise to ChatPanel, which owns its welcome branch
 * internally so the composer instance persists across welcome -> chat.
 *
 * Receives the dockview panel api as a prop, passed to SessionHeaderStrip so its double-click
 * handler can target the right group's maximizeToggle; reading `api.group?.api` at call-time
 * keeps drag/drop re-host robust.
 *
 * @param {object} [props]
 * @param {object} [props.api] - Dockview panel API (IDockviewPanelProps.api).
 */
export default function MainPanel({ api }) {
  const { activeSessionId, activeBoardId, activeWorkspaceId } = useSessionRouting()
  const { workspaceId } = useWorkspace()

  // Board route requires the workspace context to match the URL workspace before BoardTab mounts -
  // otherwise useBoardData fetches against the previous workspace and the board renders empty.
  // SessionRoutingEffect drives selectWorkspace; once workspaceId catches up, this flips to board view.
  const showBoard = activeBoardId && (!activeWorkspaceId || activeWorkspaceId === workspaceId)
  const mode = showBoard ? 'board' : activeSessionId ? 'chat' : 'welcome'
  const body = showBoard ? <BoardTab boardId={activeBoardId} /> : <ChatPanel />

  return (
    <div className="main-panel" data-testid="main-panel">
      <SessionHeaderStrip panelApi={api} />
      <div className="main-panel-body" data-testid="main-panel-content" data-mode={mode}>
        {body}
      </div>
    </div>
  )
}
