/** Panel showing todo items with status indicators, segmented by subagent. */

import { useMemo } from 'react'
import { TodoStatus } from '../../config/schema'
import { useEvents } from '../../context/EventsContext'
import { deriveBlockedFlag_live } from '../../utils/todoDiff'
import TodoRow from './components/TodoRow'

const STATUS_ICONS = {
  [TodoStatus.PENDING]: '○',
  [TodoStatus.IN_PROGRESS]: '◐',
  [TodoStatus.COMPLETED]: '●',
  blocked: '⊘',
}

/** Render panel showing todo items with status indicators. */
export default function TodosPanel() {
  const { todosBySubagent, subagentLabels, isResuming, isReplaying } = useEvents()

  const sections = useMemo(() => {
    const result = []
    const mainTodos = todosBySubagent.get('main')
    if (mainTodos && mainTodos.length > 0) {
      result.push({ key: 'main', label: null, todos: mainTodos })
    }
    for (const [key, todos] of todosBySubagent) {
      if (key !== 'main' && todos.length > 0) {
        result.push({
          key,
          label: subagentLabels.get(key) || key.slice(0, 8),
          todos,
        })
      }
    }
    return result
  }, [todosBySubagent, subagentLabels])

  if (isResuming || isReplaying) {
    return (
      <div className="todos-panel todos-loading" data-testid="panel-todos">
        Resuming...
      </div>
    )
  }

  if (sections.length === 0) {
    return (
      <div className="todos-panel todos-empty" data-testid="panel-todos">
        No todos yet
      </div>
    )
  }

  return (
    <div className="todos-panel" data-testid="panel-todos">
      {sections.map(section => (
        <div key={section.key} data-testid="todo-section">
          {section.label && (
            <div
              className="todo-section-header"
              data-testid="todo-section-header"
              title={section.label}>
              <span className="todo-section-label">{section.label}</span>
            </div>
          )}
          {section.todos.map((todo, i) => {
            const isBlocked = deriveBlockedFlag_live(todo, section.todos)
            const icon = isBlocked ? STATUS_ICONS.blocked : STATUS_ICONS[todo.status] || '○'
            return <TodoRow key={i} todo={todo} icon={icon} />
          })}
        </div>
      ))}
    </div>
  )
}
