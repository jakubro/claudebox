/** Tree node for one session row: gutter lines, expand toggle, and the row itself. */

import { ChevronDown, ChevronRight } from 'lucide-react'
import { useCallback } from 'react'
import { sessionRowDisplay } from '../../../../utils/sessionRow'
import BoundSessionItem from './components/BoundSessionItem'
import { useSessionTree } from './hooks/useSessionTree'

/**
 * @param {object} props
 * @param {object} props.session - Session object to display.
 * @param {number} props.depth - Nesting depth for indentation.
 * @param {boolean} props.isLastChild - Whether this is the last sibling.
 * @param {boolean[]} props.continuations - Per-ancestor-depth flags for vertical continuation lines.
 * @param {boolean} props.hasChildren - Whether the session has forks to expand.
 * @param {boolean} props.isExpanded - Whether its forks are shown.
 * @param {object[]} props.hiddenSessions - Every session beneath it while it is collapsed.
 */
export default function SessionTree({
  session,
  depth,
  isLastChild,
  continuations,
  hasChildren,
  isExpanded,
  hiddenSessions,
}) {
  const {
    currentSessionId,
    pinnedSessions,
    deriveSessionStatus,
    onResume,
    onRename,
    onTogglePin,
    onToggleExpanded,
    onKillContainer,
    onOpenInNewTab,
  } = useSessionTree()

  const sessionId = session.session_id

  const gutterClasses = ['sessions-tree-gutter']
  if (depth === 0) {
    gutterClasses.push('sessions-tree-gutter-root')
  }
  if (isLastChild) {
    gutterClasses.push('sessions-tree-gutter-last')
  }

  const handleToggleExpanded = useCallback(
    () => onToggleExpanded(sessionId),
    [onToggleExpanded, sessionId],
  )

  return (
    <div className="sessions-tree-node">
      {continuations.map((active, i) => (
        <div
          key={i}
          className={
            active ? 'sessions-tree-gutter-passthrough' : 'sessions-tree-gutter-passthrough-empty'
          }
        />
      ))}
      <div className={gutterClasses.join(' ')}>
        {hasChildren && (
          <button
            type="button"
            className="sessions-expand-btn"
            onClick={handleToggleExpanded}
            title={isExpanded ? 'Collapse' : 'Expand'}>
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}
      </div>
      <BoundSessionItem
        session={session}
        {...sessionRowDisplay(session, deriveSessionStatus, hiddenSessions)}
        isCurrent={sessionId === currentSessionId}
        isPinned={pinnedSessions.has(sessionId)}
        onResume={onResume}
        onRename={onRename}
        onTogglePin={onTogglePin}
        onKillContainer={onKillContainer}
        onOpenInNewTab={onOpenInNewTab}
      />
    </div>
  )
}
