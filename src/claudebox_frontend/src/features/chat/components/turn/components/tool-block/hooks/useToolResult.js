/** Extract and compute tool result state from raw tool use and result data. */

import { NotificationStatus, ToolName } from '../../../../../../../config/schema'
import { isAsyncTask } from '../../../../../../../utils/eventPredicates'
import { useTurn } from '../../../hooks/useTurn'
import { extractToolResult } from '../utils/toolResultFormatters'

/**
 * Extract and compute tool result state from raw tool use and result data.
 * Consumes TurnContext for taskNotifications.
 * @param {Object} toolUse - Tool use data with content, tool_use_id, and tool_input.
 * @param {Object} [toolResult] - Tool result with content string.
 * @param {Object} [todoDiff] - Todo diff for TodoWrite tool.
 * @returns {Object} Computed tool result state.
 */
export default function useToolResult(toolUse, toolResult, todoDiff) {
  const { taskNotifications } = useTurn()

  const toolName = toolUse?.content || 'Tool'
  const input = toolUse?.tool_input ?? {}

  // Process result if available
  const hasResult = !!toolResult
  const resultContent = toolResult?.content || ''

  // Extract structured async task data from tool_use_result (not from text parsing)
  const toolUseResult = toolResult?.tool_use_result
  const isAsync = isAsyncTask(toolUseResult)

  // Build backgroundTask from structured data for async tasks
  const asyncBackgroundTask = isAsync
    ? {
        taskId: toolUseResult.agentId,
        outputPath: toolUseResult.outputFile,
        description: toolUseResult.description,
      }
    : null

  // Look up task notification for background task correlation
  const taskNotification = asyncBackgroundTask?.taskId
    ? taskNotifications?.get(asyncBackgroundTask.taskId)
    : null

  // Async task is pending until notification arrives
  const isPending = isAsync ? !taskNotification : !hasResult

  const {
    summary,
    isError,
    details,
    jsonData,
    questions,
    plan,
    todoData,
    taskPrompt,
    systemReminders,
    persistedOutput,
    isTaskOutputRunning,
    isTaskOutputKilled,
  } = !hasResult
    ? {
        summary: '',
        isError: false,
        details: null,
        jsonData: null,
        questions: null,
        plan: null,
        todoData: null,
        taskPrompt: toolName === ToolName.TASK ? input?.prompt || null : null,
        systemReminders: null,
        persistedOutput: null,
        isTaskOutputRunning: false,
        isTaskOutputKilled: false,
        backgroundTask: null,
      }
    : extractToolResult(toolName, input, resultContent, { todoDiff })

  // Compute effective status for background tasks and TaskOutput
  const effectiveSummary = isAsync
    ? taskNotification?.summary ||
      `Running: ${asyncBackgroundTask?.description || 'background task'}`
    : summary
  const effectiveIsError = taskNotification?.status === NotificationStatus.FAILED ? true : isError
  // TaskOutput with running status should show spinner even though result exists
  const effectiveIsPending = isPending || isTaskOutputRunning

  // For async tasks, use notification content instead of raw launch message
  const effectiveDetails = isAsync ? taskNotification?.content || null : details

  return {
    summary,
    isError,
    details,
    jsonData,
    questions,
    plan,
    todoData,
    taskPrompt,
    systemReminders,
    persistedOutput,
    effectiveSummary,
    effectiveIsError,
    effectiveIsPending,
    effectiveDetails,
    asyncBackgroundTask,
    taskNotification,
    isTaskOutputKilled,
    isAsyncTask: isAsync,
    resultContent,
    hasResult,
    isPending,
  }
}
