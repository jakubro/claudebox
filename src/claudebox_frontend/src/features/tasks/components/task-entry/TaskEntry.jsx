/** Single task entry with description, duration, and staleness color. */

import { TaskStatus } from '../../../../config/schema'
import { getStalenessColor } from '../../../../utils/color'
import { formatDuration } from '../../../../utils/formatters'

/**
 * Render a single task entry with description, duration, and staleness color.
 * @param {object} props
 * @param {object} props.task - Task object with id, description, status, startTime, endTime, lastEventTime.
 * @param {number} props.now - Current timestamp for live duration and staleness calculation.
 * @param {function} props.onClick - Callback when entry is clicked.
 */
export default function TaskEntry({ task, now, onClick }) {
  const duration =
    task.status === TaskStatus.RUNNING
      ? Math.floor((now - task.startTime) / 1000)
      : task.endTime
        ? Math.floor((task.endTime - task.startTime) / 1000)
        : 0

  // Staleness color for running tasks only
  const borderStyle =
    task.status === TaskStatus.RUNNING && task.lastEventTime
      ? { borderLeftColor: getStalenessColor(now - task.lastEventTime) }
      : undefined

  return (
    <button
      type="button"
      className={`task-entry task-${task.status}`}
      style={borderStyle}
      onClick={onClick}
      data-testid="task-entry">
      <span className="task-description">{task.description}</span>
      <span className="task-duration">{formatDuration(duration)}</span>
    </button>
  )
}
