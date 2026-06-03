/** Reusable predicate functions for event-structure-aware conditions. */

import { EventType, SdkProtocol, TaskOutputStatus, ToolName } from '../config/schema'

/** Test whether event is a human-authored user message. */
export function isHumanEvent(event) {
  return event.type === EventType.USER && event.is_human
}

/** Test whether event indicates Claude is actively responding. */
export function isRespondingEvent(event) {
  return event.type === EventType.ASSISTANT
}

/** Test whether event indicates Claude finished responding. */
export function isDoneRespondingEvent(event) {
  return event.type === EventType.RESULT
}

/** Test whether tool name is an interactive tool (requires user answer). */
export function isInteractiveTool(toolName) {
  return toolName === ToolName.ASK_USER_QUESTION || toolName === ToolName.EXIT_PLAN_MODE
}

/** Test whether tool result indicates an async/background task. */
export function isAsyncTask(toolUseResult) {
  return toolUseResult?.isAsync || toolUseResult?.status === TaskOutputStatus.ASYNC_LAUNCHED
}

/**
 * Test whether an AskUserQuestion is awaiting user response.
 *
 * Checks for SDK-emitted prompt text in the result content — fragile
 * coupling to SDK output format, centralized here to limit blast radius.
 */
export function isAwaitingAnswer(resultContent) {
  return (
    typeof resultContent === 'string' && resultContent.includes(SdkProtocol.AWAITING_ANSWER_TEXT)
  )
}
