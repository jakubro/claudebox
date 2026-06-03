/** Header area for ToolBlock showing tool name, result summary, and timing. */

import { Loader2 } from 'lucide-react'
import { NotificationStatus } from '../../../../../../../config/schema'
import { formatBlockTiming } from '../../../../../../../utils/formatters'
import { getSummaryText, getToolStatus } from '../utils/toolResultFormatters'

/**
 * Render the header area of a ToolBlock with tool name, status bullet, and result summary.
 * @param {Object} props
 * @param {string} props.header - Formatted header text (e.g., 'Read(file.txt)').
 * @param {string} props.toolName - Tool name for summary computation.
 * @param {string} [props.tooltip] - Tooltip text for the tool name.
 * @param {string} props.summary - Summary text to display.
 * @param {boolean} props.hasExpandable - Whether there is expandable content.
 * @param {Function} props.onToggle - Callback when header is clicked.
 * @param {Object} props.toolStatus - Grouped status object.
 * @param {boolean} props.toolStatus.isPending - Whether the tool is still running.
 * @param {boolean} props.toolStatus.isAwaitingAnswer - Whether awaiting user response.
 * @param {boolean} props.toolStatus.wasAnswered - Whether user has responded.
 * @param {boolean} props.toolStatus.wasSkipped - Whether user skipped the form.
 * @param {boolean} props.toolStatus.isError - Whether the tool result is an error.
 * @param {string} [props.toolStatus.answerLabel] - Label for answered interactive tools.
 * @param {Object} [props.toolStatus.taskNotification] - Background task notification with status.
 * @param {boolean} [props.toolStatus.isTaskOutputKilled] - Whether the synchronous TaskOutput result reports killed status.
 * @param {number} [props.toolStatus.blockDuration] - Block duration in seconds.
 * @param {number} [props.toolStatus.blockRelativeTime] - Relative offset from turn start in seconds.
 */
export default function ToolBlockHeader({
  header,
  toolName,
  tooltip,
  summary,
  hasExpandable,
  onToggle,
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
  } = toolStatus

  // Determine bullet status — killed (from notification or TaskOutput result) takes precedence
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
        {timing && <span className="block-timing">{timing}</span>}
      </div>
      <div className="tool-result">
        <span className="tool-corner">└</span>
        {isPending ? (
          <span className="tool-pending">
            <Loader2 size={12} className="spinner" />
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
      </div>
    </div>
  )
}
