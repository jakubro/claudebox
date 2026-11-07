/** Reusable predicate functions for event-structure-aware conditions. */

import { EventSubtype, EventType, TaskOutputStatus, ToolName } from '../config/schema'

/** Test whether event is a human-authored user message. */
export function isHumanEvent(event) {
  return event.type === EventType.USER && event.is_human
}

/** Test whether event is a top-level message from a session this one spawned. */
export function isSiblingMessage(event) {
  return (
    event.type === EventType.SYSTEM &&
    event.subtype === EventSubtype.SIBLING_MESSAGE &&
    !event.parent_tool_use_id
  )
}

/** Test whether event indicates Claude is actively responding - a background subagent's own output is not. */
export function isRespondingEvent(event) {
  return event.type === EventType.ASSISTANT && !event.parent_tool_use_id
}

/** Test whether event indicates Claude finished responding - a result, or a reported failure. */
export function isDoneRespondingEvent(event) {
  return (
    event.type === EventType.RESULT ||
    (event.type === EventType.SYSTEM && event.subtype === EventSubtype.ERROR)
  )
}

/** Test whether tool name is an interactive tool (requires user answer). */
export function isInteractiveTool(toolName) {
  return toolName === ToolName.ASK_USER_QUESTION || toolName === ToolName.EXIT_PLAN_MODE
}

/** Test whether tool result indicates an async/background task. */
export function isAsyncTask(toolUseResult) {
  return toolUseResult?.isAsync || toolUseResult?.status === TaskOutputStatus.ASYNC_LAUNCHED
}
