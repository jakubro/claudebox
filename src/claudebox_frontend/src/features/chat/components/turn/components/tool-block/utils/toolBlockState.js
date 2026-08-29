/** Predicates for ToolBlock display state - extracted from ToolBlock.jsx, no React APIs. */

import { ToolName } from '../../../../../../../config/schema'
import { shouldCollapseByDefault } from './toolResultFormatters'

/** AskUserQuestion is awaiting an answer when a form is the surface: a form can render and the question is unanswered - independent of what the runtime reported. */
export function isAskUserAwaitingAnswer(toolName, canRenderForm, wasAnswered) {
  return toolName === ToolName.ASK_USER_QUESTION && canRenderForm && !wasAnswered
}

export function isPlanAwaitingAnswer(toolName, plan, wasAnswered) {
  return toolName === ToolName.EXIT_PLAN_MODE && plan && !wasAnswered
}

/** Single-line result identical to the summary - keep expandable but start collapsed. */
export function isSingleLineDuplicate(effectiveDetails, effectiveSummary) {
  return (
    effectiveDetails &&
    !effectiveDetails.includes('\n') &&
    effectiveDetails.trim() === effectiveSummary?.trim()
  )
}

/** Whether the block has any payload worth expanding. */
export function hasExpandableContent({
  effectiveDetails,
  jsonData,
  contentBlocks,
  hasNested,
  skillContent,
  questions,
  plan,
  pendingQuestions,
  todoData,
  taskPrompt,
  systemReminders,
  persistedOutput,
  toolInput,
  command,
}) {
  return Boolean(
    effectiveDetails ||
      jsonData ||
      contentBlocks ||
      hasNested ||
      skillContent ||
      questions ||
      plan ||
      pendingQuestions ||
      todoData ||
      taskPrompt ||
      systemReminders ||
      persistedOutput ||
      toolInput ||
      command,
  )
}

/** Default-collapsed state for the block: dupe-of-summary or per-tool defaults. */
export function shouldStartCollapsed({
  toolName,
  singleLineDuplicate,
  jsonData,
  contentBlocks,
  hasNested,
  isPending,
  wasAnswered,
}) {
  return (
    singleLineDuplicate ||
    shouldCollapseByDefault(toolName, jsonData, hasNested, isPending, wasAnswered, contentBlocks)
  )
}

/** Live duration in seconds for a still-pending block, only after >= 30s. */
export function computeLiveBlockDuration({
  isAsyncTask,
  toolUseTime,
  toolResultTime,
  isActiveTurn,
  now,
}) {
  if (isAsyncTask || !toolUseTime) {
    return null
  }
  if (!toolResultTime && isActiveTurn && now) {
    const duration = Math.max(0, Math.floor((now - toolUseTime) / 1000))
    return duration >= 30 ? duration : null
  }
  return null
}
