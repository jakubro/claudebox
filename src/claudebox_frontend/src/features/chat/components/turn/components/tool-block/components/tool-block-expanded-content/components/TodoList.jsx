/** Render todo diff view showing only changed items. */

import { deriveBlockedFlag_run } from '../../../../../../../../../utils/todoDiff'

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

/**
 * Render a diff view of todo items, showing only changed items with status icons.
 * Items carrying a `subtitle` render a muted second line; items with unresolved
 * `blockedBy` deps render with the ⊘ icon (the status class stays as the item's
 * actual status; only the icon swaps).
 * @param {Object} props
 * @param {Array} [props.todos] - Fallback todo list when no diff is available.
 * @param {Object} [props.todoDiff] - Diff object with completed, started, added, and removed arrays.
 */
export default function TodoList({ todos, todoDiff }) {
  // Build list of changed items to display
  // Order: completed first, then started (in_progress), then added (pending)
  const changedItems = []

  if (todoDiff) {
    // Add completed items
    for (const todo of todoDiff.completed || []) {
      changedItems.push({ ...todo, status: 'completed' })
    }
    // Add started items (in_progress)
    for (const todo of todoDiff.started || []) {
      changedItems.push({ ...todo, status: 'in_progress' })
    }
    // Add new pending items
    for (const todo of todoDiff.added || []) {
      changedItems.push({ ...todo, status: 'pending' })
    }
    // Add removed items
    for (const todo of todoDiff.removed || []) {
      changedItems.push({ ...todo, status: 'removed' })
    }
  } else if (todos && todos.length > 0) {
    // Fallback: no diff available, show all items as added (pending)
    for (const todo of todos) {
      changedItems.push({ ...todo, status: 'pending' })
    }
  }

  if (changedItems.length === 0) {
    return <div className="todo-list todo-list-empty">No changes</div>
  }

  return (
    <div className="todo-list">
      {changedItems.map((todo, i) => {
        const isBlocked = deriveBlockedFlag_run(todo, changedItems)
        const icon = isBlocked ? STATUS_ICONS.blocked : STATUS_ICONS[todo.status] || '○'
        const statusClass = STATUS_CLASSES[todo.status] || 'todo-pending'

        return (
          <div key={i} className={`todo-item ${statusClass}`}>
            <div className="todo-row">
              <span className="todo-icon">{icon}</span>
              <span className="todo-content">{todo.content}</span>
            </div>
            {todo.subtitle && (
              <div className="todo-subtitle" data-testid="todo-subtitle">
                {todo.subtitle}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
