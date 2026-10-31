/** Header area for ToolBlock showing tool name, result summary, and timing. */

// audit-ignore-file: excessive-props

import { Bookmark, ExternalLink, EyeOff, Loader2 } from 'lucide-react'
import { NotificationStatus } from '../../../../../../../config/schema'
import { formatBlockTiming } from '../../../../../../../utils/formatters'
import InjectedContext from '../../InjectedContext'
import { getSummaryText, getToolStatus } from '../utils/toolResultFormatters'

/**
 * @param {string} props.header - Formatted header text (e.g., 'Read(file.txt)').
 * @param {string} [props.editorUrl] - Resolved "open in editor" URI; omit to hide the affordance.
 * @param {{active: boolean, onToggle: function}} [props.bookmark] - Bookmark control; omit to hide it.
 * @param {{active: boolean, onToggle: function}} [props.hideInFocused] - Hide-from-Focused control;
 *   omit to hide it.
 * @param {Object} [props.activity] - What to draw beside the spinner while pending: `{kind: 'call',
 *   status, title}` or `{kind: 'text', text}`. Absent for every tool but a running Task.
 * @param {Array} [props.injected] - Text the agent received here that no one wrote.
 * @param {Object} props.toolStatus - Grouped status object.
 * @param {Object} [props.toolStatus.taskNotification] - Background task notification with status.
 * @param {boolean} [props.toolStatus.isTaskOutputKilled] - Whether TaskOutput's sync result reports killed.
 * @param {number} [props.toolStatus.blockDuration] - Block duration in seconds.
 * @param {number} [props.toolStatus.blockRelativeTime] - Relative offset from turn start in seconds.
 * @param {number} [props.toolStatus.blockTime] - Epoch ms the offset measures to; its hover tooltip.
 */
export default function ToolBlockHeader({
  header,
  toolName,
  tooltip,
  summary,
  hasExpandable,
  onToggle,
  editorUrl = null,
  bookmark = null,
  hideInFocused = null,
  activity = null,
  injected = null,
  toolStatus,
}) {
  const {
    isPending,
    isAwaitingAnswer,
    wasAnswered,
    wasSkipped = false,
    isError,
    answerLabel = null,
    taskNotification = null,
    isTaskOutputKilled = false,
    blockDuration = null,
    blockRelativeTime = null,
    blockTime = null,
  } = toolStatus

  // Determine bullet status - killed (from notification or TaskOutput result) takes precedence
  const isKilled = taskNotification?.status === NotificationStatus.KILLED || isTaskOutputKilled
  const bulletStatus = isKilled ? 'killed' : getToolStatus(isPending, isAwaitingAnswer, isError)

  const timing = formatBlockTiming(blockDuration, blockRelativeTime)

  return (
    <div
      className="tool-header-area"
      onClick={onToggle}
      style={{ cursor: hasExpandable ? 'pointer' : 'default' }}>
      <div className="tool-header">
        <span className={`tool-bullet ${bulletStatus}`}>●</span>
        <span className="tool-name" title={tooltip || undefined}>
          {header}
        </span>
        {editorUrl && (
          <button
            type="button"
            className="tool-open-in-editor-btn"
            title="Open in editor"
            onClick={e => {
              e.stopPropagation()
              window.open(editorUrl, '_blank', 'noopener,noreferrer')
            }}>
            <ExternalLink size={11} />
          </button>
        )}
        {bookmark && (
          <button
            type="button"
            className={`tool-bookmark-btn${bookmark.active ? ' active' : ''}`}
            title={bookmark.active ? 'Remove bookmark' : 'Bookmark this tool call'}
            onClick={e => {
              e.stopPropagation()
              bookmark.onToggle()
            }}>
            <Bookmark size={11} fill={bookmark.active ? 'currentColor' : 'none'} />
          </button>
        )}
        {hideInFocused && (
          <button
            type="button"
            className={`tool-focus-hide-btn${hideInFocused.active ? ' active' : ''}`}
            data-testid="tool-focus-hide-btn"
            aria-pressed={hideInFocused.active}
            title={hideInFocused.active ? 'Show in Focused' : 'Hide in Focused'}
            onClick={e => {
              e.stopPropagation()
              hideInFocused.onToggle()
            }}>
            <EyeOff size={11} />
          </button>
        )}
        {timing && (
          <span
            className="block-timing"
            title={
              blockRelativeTime !== null && blockTime !== null
                ? new Date(blockTime).toLocaleString()
                : undefined
            }>
            {timing}
          </span>
        )}
      </div>
      <div className="tool-result">
        <span className="tool-corner">└</span>
        {isPending ? (
          <span className="tool-pending">
            <Loader2 size={12} className="spinner" />
            {activity?.kind === 'call' && (
              <>
                <span className={`tool-bullet ${activity.status}`}>●</span>
                <span className="tool-activity" title={activity.title}>
                  {activity.title}
                </span>
              </>
            )}
            {activity?.kind === 'text' && (
              <span className="tool-activity" title={activity.text}>
                {activity.text}
              </span>
            )}
          </span>
        ) : (
          <span className={`tool-summary ${isError ? 'error' : ''}`} title={summary || undefined}>
            {getSummaryText(
              toolName,
              isPending,
              isAwaitingAnswer,
              wasAnswered,
              summary,
              isError,
              wasSkipped,
              answerLabel,
            )}
          </span>
        )}
        <InjectedContext entries={injected} />
      </div>
    </div>
  )
}
