/** Single task entry with description, duration, and - for a subagent - staleness color. */

import { Terminal } from 'lucide-react'
import { TaskKind, TaskStatus } from '../../../../config/schema'
import { getStalenessColor } from '../../../../utils/color'
import { formatDuration } from '../../../../utils/formatters'

/**
 * @param {object} props
 * @param {object} props.task - A row from extractTasks.
 * @param {number} props.now - Current timestamp for live duration and staleness calculation.
 */
export default function TaskEntry({ task, now, onClick }) {
  const duration =
    task.status === TaskStatus.RUNNING
      ? Math.floor((now - task.startTime) / 1000)
      : task.endTime
        ? Math.floor((task.endTime - task.startTime) / 1000)
        : 0
  const isCommand = task.kind === TaskKind.COMMAND

  // A quiet command is not a stuck one, so staleness colors running subagents only.
  const borderStyle =
    task.status === TaskStatus.RUNNING && task.lastEventTime && !isCommand
      ? { borderLeftColor: getStalenessColor(now - task.lastEventTime) }
      : undefined

  return (
    <button
      type="button"
      className={`task-entry task-${task.status}`}
      style={borderStyle}
      onClick={onClick}
      data-testid="task-entry">
      {isCommand && <Terminal size={12} className="task-kind-icon" data-testid="task-kind-icon" />}
      <span className="task-description">{task.description}</span>
      <span className="task-duration">{formatDuration(duration)}</span>
    </button>
  )
}
