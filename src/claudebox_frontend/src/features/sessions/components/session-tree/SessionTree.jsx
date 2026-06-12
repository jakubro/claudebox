/** Recursive tree node for session with optional children. */

import { ChevronDown, ChevronRight } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import SessionItem from './components/SessionItem'
import { useSessionTree } from './hooks/useSessionTree'

/**
 * Render a session node and recursively render its children.
 * @param {object} props
 * @param {object} props.session - Session object to display.
 * @param {number} props.depth - Nesting depth for indentation.
 * @param {boolean} [props.isLastChild=true] - Whether this is the last sibling.
 * @param {boolean[]} [props.continuations=[]] - Per-ancestor-depth flags for vertical continuation lines.
 */
export default function SessionTree({ session, depth, isLastChild = true, continuations = [] }) {
  const {
    childrenMap,
    expandedSessions,
    currentSessionId,
    pinnedSessions,
    onResume,
    onRename,
    onTogglePin,
    onToggleExpanded,
    onKillContainer,
    onOpenInNewTab,
  } = useSessionTree()

  const children = childrenMap.get(session.session_id) || []
  const hasChildren = children.length > 0
  const isExpanded = expandedSessions.has(session.session_id)
  const sessionId = session.session_id

  // Build CSS classes for tree line rendering
  const gutterClasses = ['sessions-tree-gutter']
  if (depth === 0) {
    gutterClasses.push('sessions-tree-gutter-root')
  }
  if (isLastChild) {
    gutterClasses.push('sessions-tree-gutter-last')
  }

  const childContinuations = [...continuations, depth > 0 && !isLastChild]

  // Bind the row's session_id into each callback once. Memoized so memo'd
  // SessionItem can bail out across parent re-renders - bare inline arrows
  // would defeat the bail-out by re-identifying every render.
  const handleToggleExpanded = useCallback(
    () => onToggleExpanded(sessionId),
    [onToggleExpanded, sessionId],
  )
  const itemCallbacks = useMemo(
    () => ({
      onResume: () => onResume(sessionId),
      onRename: name => onRename(sessionId, name),
      onTogglePin: () => onTogglePin(sessionId),
      onKillContainer: () => onKillContainer(sessionId),
      onOpenInNewTab: () => onOpenInNewTab(sessionId),
    }),
    [sessionId, onResume, onRename, onTogglePin, onKillContainer, onOpenInNewTab],
  )

  return (
    <>
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
        <SessionItem
          session={session}
          isCurrent={sessionId === currentSessionId}
          isPinned={pinnedSessions.has(sessionId)}
          {...itemCallbacks}
        />
      </div>
      {isExpanded &&
        children.map((child, index) => (
          <SessionTree
            key={child.session_id}
            session={child}
            depth={depth + 1}
            isLastChild={index === children.length - 1}
            continuations={childContinuations}
          />
        ))}
    </>
  )
}
