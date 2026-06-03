/** Single container row — status dot + identifiers + state/kind + resume control. */

import { Square } from 'lucide-react'
import { useCallback } from 'react'
import { deleteContainer } from '../../api/containers'
import ResumeControl from '../../components/ResumeControl'
import { useSessionRouting } from '../../context/SessionRoutingContext'
import { useSessionsList } from '../../context/SessionsContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import useCopyFlash from '../../hooks/useCopyFlash'
import { formatRelativeTime } from '../../utils/formatters'
import { formatSessionDirTooltip } from '../../utils/session'
import { capitalize } from '../../utils/strings'

/** Color map for the status indicator dot. */
const STATUS_COLORS = {
  running: '#22c55e',
  starting: '#3b82f6',
  stopping: '#f59e0b',
  crashed: '#ef4444',
  stopped: '#737373',
}

/**
 * One container row — status dot, container id, session id, session name, state,
 * kind, age, action cluster. Stop button (composite delete) shows on running/
 * starting rows; ResumeControl shows whenever the container carries a session id
 * and that session is not the currently-active one. Container id and session id
 * each carry a click-to-copy affordance with a "Copied!" overlay (matching the
 * footer's container pill and the sessions panel's session-id span).
 *
 * @param {object} props
 * @param {object} props.container - Container record from the workspace endpoint.
 */
function ContainerRow({ container }) {
  const { navigateToSession, activeSessionId } = useSessionRouting()
  const { sessions } = useSessionsList()
  const { workspaceId } = useWorkspace()
  const [backendCopied, copyBackend] = useCopyFlash()
  const [sessionDirCopied, copySessionDir] = useCopyFlash()

  const handleStop = useCallback(() => {
    deleteContainer(container.id).catch(err => console.debug('ContainerRow: stop failed', err))
  }, [container.id])

  const handleResume = useCallback(() => {
    if (container.session_id) {
      navigateToSession(workspaceId, container.session_id)
    }
  }, [workspaceId, container.session_id, navigateToSession])

  const handleOpenInNewTab = useCallback(() => {
    if (container.session_id && workspaceId) {
      const url = `${window.location.origin}?workspace=${workspaceId}&session=${container.session_id}`
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }, [workspaceId, container.session_id])

  const status = container.status || 'stopped'
  const dotColor = STATUS_COLORS[status] || STATUS_COLORS.stopped
  const kind = container.labels?.kind || ''
  const isRunning = status === 'running' || status === 'starting'
  const isCurrent = !!container.session_id && container.session_id === activeSessionId

  // Display id is the runtime backend_id (matches footer); container.id stays
  // bound to API calls + test selectors. Fall back to '' when backend_id is
  // missing so the cell renders empty rather than 'undefined'.
  const displayId = container.backend_id || ''
  const session = container.session_id
    ? sessions?.find?.(s => s.session_id === container.session_id)
    : null
  const sessionName = session?.name || ''
  const sessionDir = session?.session_dir || ''
  const shortSessionId = container.session_id ? container.session_id.slice(0, 8) : ''

  return (
    <div
      className={`containers-row${isCurrent ? ' containers-row-current' : ''}`}
      data-testid={`container-row-${container.id}`}>
      <span
        className="containers-status-dot"
        style={{ background: dotColor }}
        title={`Status: ${status}`}
      />
      <span
        className={`containers-id${displayId ? ' containers-id-clickable' : ''}`}
        title={displayId ? `Container — ${displayId}` : undefined}
        onClick={displayId ? () => copyBackend(displayId) : undefined}
        style={{ cursor: displayId ? 'pointer' : undefined }}>
        <span style={{ visibility: backendCopied ? 'hidden' : 'visible' }}>
          {displayId.slice(0, 12)}
        </span>
        {backendCopied && <span className="containers-id-copied">Copied!</span>}
      </span>
      <span
        className={`containers-session-id${sessionDir ? ' containers-session-id-clickable' : ''}`}
        title={sessionDir ? formatSessionDirTooltip(sessionDir) : undefined}
        onClick={sessionDir ? () => copySessionDir(sessionDir) : undefined}
        style={{ cursor: sessionDir ? 'pointer' : undefined }}>
        <span style={{ visibility: sessionDirCopied ? 'hidden' : 'visible' }}>
          {shortSessionId}
        </span>
        {sessionDirCopied && <span className="containers-session-id-copied">Copied!</span>}
      </span>
      <span className="containers-session-name" title={sessionName || undefined}>
        {sessionName}
      </span>
      <span className={`containers-state containers-state-${status}`}>{capitalize(status)}</span>
      <span className="containers-kind">{capitalize(kind)}</span>
      <span className="containers-age">
        {container.created_at ? formatRelativeTime(container.created_at) : '—'}
      </span>
      <div className="containers-actions">
        {isRunning && (
          <button
            type="button"
            className="containers-action-btn"
            onClick={handleStop}
            title="Stop container"
            data-testid={`container-stop-${container.id}`}>
            <Square size={12} />
          </button>
        )}
        {!isCurrent && container.session_id && (
          <ResumeControl
            onResume={handleResume}
            onOpenInNewTab={handleOpenInNewTab}
            title="Open attached session (Alt+Click or middle-click for new browser tab)"
          />
        )}
      </div>
    </div>
  )
}

export default ContainerRow
