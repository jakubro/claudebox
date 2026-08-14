/** Grouped Todos block - collapses a run of Task* tool_uses into a single ToolBlock-chrome view. */

import { useContext, useMemo, useState } from 'react'
import {
  bucketize,
  deriveBlockedFlag_run,
  mergeRunItems,
} from '../../../../../../../../../utils/todoDiff'
import { TurnContext } from '../../../../../TurnContext'
import ToolBlockHeader from '../../ToolBlockHeader'
import { formatCounts } from './utils/formatCounts'

const STATUS_ICONS = {
  completed: '●',
  in_progress: '◐',
  pending: '○',
  blocked: '⊘',
  removed: '✕',
}

const STATUS_CLASSES = {
  completed: 'todo-completed',
  in_progress: 'todo-in-progress',
  pending: 'todo-pending',
  removed: 'todo-removed',
}

// Inert tool-status payload - a synthetic chrome host, not a real tool with pending/awaiting/error states.
const INERT_STATUS = {
  isPending: false,
  isAwaitingAnswer: false,
  wasAnswered: false,
  isError: false,
}

/**
 * Collapses a consecutive run of TaskCreate/TaskUpdate/TaskGet/TaskList tool_uses (one subagent partition)
 * into a single panel mounted inside the standard ToolBlock chrome.
 * Default-expanded; clicking the chrome header collapses the row body.
 * Row identity is by `_taskId`: the latest item per id across the run wins, so intermediate transitions collapse.
 * Frozen-snapshot semantics: content does not update as the agent does later work outside the run.
 *
 * @param {Array<{toolUseId: string}>} props.taskBlocks - The run's task-list tool blocks, in order.
 */
export default function TodosGroup({ taskBlocks }) {
  const turn = useContext(TurnContext)
  const todoDiffs = turn?.todoDiffs

  const [expanded, setExpanded] = useState(true)

  const mergedItems = useMemo(() => mergeRunItems(taskBlocks, todoDiffs), [taskBlocks, todoDiffs])
  const { counts, rowGroups } = useMemo(() => bucketize(mergedItems), [mergedItems])
  const summary = formatCounts(counts, STATUS_ICONS)

  // Suppresses the chrome entirely when there's nothing to show. Empty rowGroups has three causes:
  // a streaming race (tool_use emitted, matching tool_result not yet in todoDiffs);
  // an empty-items mutation (TaskCreate with no items, or TaskUpdate removing the last item);
  // or any future bucketize edge case yielding no rows.
  // Returning null here produces no DOM; the chrome appears once todoDiffs populates and re-renders.
  if (rowGroups.length === 0) {
    return null
  }

  return (
    <div className="tool-block" data-testid="todos-group">
      <ToolBlockHeader
        header="Todos"
        toolName="Todos"
        summary={summary}
        hasExpandable={true}
        onToggle={() => setExpanded(prev => !prev)}
        toolStatus={INERT_STATUS}
      />
      {expanded && (
        <div className="tool-expanded-content">
          <div className="todos-group-rows" data-testid="todos-group-rows">
            {rowGroups.map((row, i) => {
              const isBlocked = deriveBlockedFlag_run(row, mergedItems)
              const icon = isBlocked ? STATUS_ICONS.blocked : STATUS_ICONS[row.status] || '○'
              const statusClass = STATUS_CLASSES[row.status] || 'todo-pending'
              return (
                <div key={i} className={`todo-item ${statusClass}`}>
                  <span className="todo-icon">{icon}</span>
                  <span className="todo-content">{row.content}</span>
                  <span className="todo-description" title={row.subtitle || undefined}>
                    {row.subtitle || ''}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
