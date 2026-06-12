/** Pure badge-count aggregation - extracted from useBadgeCounts.js, no React APIs. */

import { TaskStatus, TodoStatus } from '../../../config/schema'
import { extractTasks, getMcpServers } from '../../../utils/eventProcessing'

/**
 * Aggregate badge counters and dot flags for the icon strip from raw context state.
 *
 * @param {{
 *   events: Array,
 *   todosBySubagent: Map,
 *   taskNotifications: object,
 *   stash: Array,
 *   hasUnreadErrors: boolean,
 * }} params
 * @returns {{ todoCount: number, stashCount: number, taskCount: number, mcpFailedCount: number, logsHasErrors: boolean }}
 */
export function computeBadgeCounts({
  events,
  todosBySubagent,
  taskNotifications,
  stash,
  hasUnreadErrors,
}) {
  let todoCount = 0
  for (const todos of todosBySubagent.values()) {
    todoCount += todos.filter(t => t.status !== TodoStatus.COMPLETED).length
  }

  const tasks = extractTasks(events, taskNotifications)
  const taskCount = tasks.filter(t => t.status === TaskStatus.RUNNING).length

  const mcpServers = getMcpServers(events)
  const mcpFailedCount = mcpServers.filter(s => s.status === 'failed').length

  return {
    todoCount,
    stashCount: stash.length,
    taskCount,
    mcpFailedCount,
    logsHasErrors: hasUnreadErrors,
  }
}
