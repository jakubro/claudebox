/** Pure badge-count aggregation with no React APIs, consumed by the useBadgeCounts hook. */

import { TaskStatus, TodoStatus } from '../../../config/schema'
import { extractCrons, extractTasks, getMcpServers } from '../../../utils/eventProcessing'

/**
 * @param {{
 *   events: Array,
 *   todosBySubagent: Map,
 *   taskNotifications: object,
 *   backgroundLaunches: Map,
 *   now: number,
 *   turnStartedAt: number|null,
 *   stash: Array,
 *   hasUnreadErrors: boolean,
 * }} params
 * @returns {{
 *   todoCount: number,
 *   stashCount: number,
 *   taskCount: number,
 *   cronCount: number,
 *   mcpFailedCount: number,
 *   logsHasErrors: boolean,
 * }}
 */
export function computeBadgeCounts({
  events,
  todosBySubagent,
  taskNotifications,
  backgroundLaunches,
  now,
  turnStartedAt,
  stash,
  hasUnreadErrors,
}) {
  let todoCount = 0
  for (const todos of todosBySubagent.values()) {
    todoCount += todos.filter(t => t.status !== TodoStatus.COMPLETED).length
  }

  const tasks = extractTasks(events, taskNotifications, backgroundLaunches)
  const taskCount = tasks.filter(t => t.status === TaskStatus.RUNNING).length
  const cronCount = extractCrons(events, now, turnStartedAt).length

  const mcpServers = getMcpServers(events)
  const mcpFailedCount = mcpServers.filter(s => s.status === 'failed').length

  return {
    todoCount,
    stashCount: stash.length,
    taskCount,
    cronCount,
    mcpFailedCount,
    logsHasErrors: hasUnreadErrors,
  }
}
