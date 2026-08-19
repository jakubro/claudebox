/** Panel showing all Task tool invocations with status and navigation. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import PanelListItem from '../../components/PanelListItem'
import { TaskStatus } from '../../config/schema'
import { LIVE_TICK_INTERVAL_MS } from '../../config/timing'
import { useAppActions } from '../../context/AppActionsContext'
import { useEvents } from '../../context/EventsContext'
import { extractTasks } from '../../utils/eventProcessing'
import { MOUNT_FRAMES, pollFrames } from '../../utils/mountTurn'
import TaskEntry from './components/task-entry'
import { findVisibleToolBlock, jumpToTask } from './utils/taskScroll'

const FILTERS = [
  { id: TaskStatus.RUNNING, label: 'Active' },
  { id: 'all', label: 'All' },
]

export default function TasksPanel() {
  const { events, taskNotifications, isResuming, isReplaying } = useEvents()
  const {
    focusChatTab,
    scrollToTurnRef,
    expandTurnRef,
    markUserIntentRef,
    markProgrammaticScrollRef,
  } = useAppActions()
  const [filter, setFilter] = useState('running')
  const [now, setNow] = useState(Date.now())

  // Live-tick for running task durations
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), LIVE_TICK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  const allTasks = useMemo(
    () => extractTasks(events, taskNotifications),
    [events, taskNotifications],
  )

  const filteredTasks = useMemo(() => {
    if (filter === 'all') {
      return allTasks
    }
    return allTasks.filter(t => t.status === filter)
  }, [allTasks, filter])

  // Count by status for filter badges
  const counts = useMemo(() => {
    const c = { all: allTasks.length, running: 0 }
    for (const t of allTasks) {
      if (t.status === TaskStatus.RUNNING) {
        c.running++
      }
    }
    return c
  }, [allTasks])

  const handleTaskClick = useCallback(
    task => {
      focusChatTab()

      requestAnimationFrame(() => {
        // Expanding and jumping are independent - a task may need either, both, or neither.
        const proceed = () => {
          if (task.turnId) {
            expandTurnRef.current?.(task.turnId)
          }
          pollFrames(
            MOUNT_FRAMES,
            () => findVisibleToolBlock(task.id),
            el => {
              if (el) {
                jumpToTask(el, { markUserIntentRef, markProgrammaticScrollRef })
              }
            },
          )
        }

        // Fast path: a running task's turn is never windowed or collapsed, so it's mounted.
        if (document.querySelector(`[data-tool-use-id="${CSS.escape(String(task.id))}"]`)) {
          proceed()
          return
        }

        // Windowed out, turn id known: mount it first via the ref ChatPanel publishes.
        if (task.turnId && scrollToTurnRef.current) {
          scrollToTurnRef.current(task.turnId, turnEl => {
            if (turnEl) {
              proceed()
            }
          })
          return
        }

        // Unresolvable (no turn id, or absent from the historical array): no crash, no jump.
      })
    },
    [focusChatTab, expandTurnRef, scrollToTurnRef, markUserIntentRef, markProgrammaticScrollRef],
  )

  if (isResuming || isReplaying) {
    return (
      <div className="tasks-panel tasks-loading" data-testid="panel-tasks">
        Resuming...
      </div>
    )
  }

  // Panel-level empty state (matches Todos/Stash pattern)
  if (allTasks.length === 0) {
    return (
      <div className="tasks-panel tasks-empty" data-testid="panel-tasks">
        No tasks
      </div>
    )
  }

  return (
    <div className="tasks-panel" data-testid="panel-tasks">
      <div className="tasks-filters">
        {FILTERS.map(f => (
          <PanelListItem
            key={f.id}
            className="tasks-filter-btn"
            label={f.label}
            active={filter === f.id}
            onClick={() => setFilter(f.id)}
            count={counts[f.id]}
          />
        ))}
      </div>

      <div className="tasks-list">
        {filteredTasks.length === 0 ? (
          <div className="tasks-list-empty">No tasks</div>
        ) : (
          filteredTasks.map(task => (
            <TaskEntry key={task.id} task={task} now={now} onClick={() => handleTaskClick(task)} />
          ))
        )}
      </div>
    </div>
  )
}
