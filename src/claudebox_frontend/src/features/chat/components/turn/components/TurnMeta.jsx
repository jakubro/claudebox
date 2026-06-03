/** Turn metadata row with collapse toggle, duration, timestamp, and action buttons. */

import { Bookmark, ChevronDown, ChevronRight } from 'lucide-react'
import CopyButton from '../../../../../components/CopyButton.jsx'
import { formatDuration, formatRelativeTime } from '../../../../../utils/formatters'

/**
 * Render the turn metadata row with collapse toggle, duration, timestamp, bookmark, and copy button.
 * @param {Object} props
 * @param {number} props.startTime - Turn start timestamp in ms.
 * @param {number} props.duration - Turn duration in seconds.
 * @param {boolean} props.canCollapse - Whether the turn can be collapsed.
 * @param {boolean} props.collapsed - Whether the turn is currently collapsed.
 * @param {Function} props.onToggleCollapse - Callback to toggle collapse state.
 * @param {string} props.assistantTextContent - Full assistant text for copy button.
 * @param {string} props.turnId - Turn identifier for bookmark action.
 * @param {boolean} props.isBookmarked - Whether the assistant response is bookmarked.
 * @param {Function} props.onToggleBookmark - Callback to toggle bookmark.
 */
export default function TurnMeta({
  startTime,
  duration,
  canCollapse,
  collapsed,
  onToggleCollapse,
  assistantTextContent,
  turnId,
  isBookmarked = false,
  onToggleBookmark,
}) {
  return (
    <div
      className={`turn-meta ${canCollapse ? 'turn-meta-collapsible' : ''}`}
      onClick={canCollapse ? onToggleCollapse : undefined}
      style={canCollapse ? { cursor: 'pointer' } : undefined}>
      {turnId && onToggleBookmark && (
        <span className="turn-bookmark-btn-wrapper" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            className={`turn-bookmark-btn ${isBookmarked ? 'active' : ''}`}
            title={isBookmarked ? 'Remove bookmark' : 'Bookmark this response'}
            onClick={() =>
              onToggleBookmark(turnId, 'assistant', assistantTextContent?.slice(0, 80) || '')
            }>
            <Bookmark size={10} fill={isBookmarked ? 'currentColor' : 'none'} />
          </button>
        </span>
      )}
      {canCollapse && assistantTextContent && !collapsed && (
        <span className="turn-copy-btn-wrapper" onClick={e => e.stopPropagation()}>
          <CopyButton
            text={assistantTextContent}
            className="turn-copy-btn"
            title="Copy turn"
            size={10}
          />
        </span>
      )}
      {canCollapse && (
        <span className="turn-collapse-icon">
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </span>
      )}
      <span className="turn-duration" title={new Date(startTime).toLocaleString()}>
        {formatDuration(duration ?? 0)}
      </span>
      <span className="turn-timestamp" title={new Date(startTime).toLocaleString()}>
        {formatRelativeTime(startTime)}
      </span>
    </div>
  )
}
