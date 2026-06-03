/** Predicates for ToolBlock display state — extracted from ToolBlock.jsx, no React APIs. */

import { SdkProtocol, ToolName } from '../../../../../../../config/schema'
import { shouldCollapseByDefault } from './toolResultFormatters'

/**
 * AskUserQuestion is awaiting an answer when the tool is pending or its result still
 * carries the awaiting marker, and the user has not yet answered.
 */
export function isAskUserAwaitingAnswer(toolName, isPending, resultContent, wasAnswered) {
  return (
    toolName === ToolName.ASK_USER_QUESTION &&
    (isPending || resultContent.includes(SdkProtocol.AWAITING_ANSWER_TEXT)) &&
    !wasAnswered
  )
}

/**
 * ExitPlanMode is awaiting an answer when a plan is present and unanswered.
 */
export function isPlanAwaitingAnswer(toolName, plan, wasAnswered) {
  return toolName === ToolName.EXIT_PLAN_MODE && plan && !wasAnswered
}

/**
 * Single-line result identical to the summary — keep expandable but start collapsed.
 */
export function isSingleLineDuplicate(effectiveDetails, effectiveSummary) {
  return (
    effectiveDetails &&
    !effectiveDetails.includes('\n') &&
    effectiveDetails.trim() === effectiveSummary?.trim()
  )
}

/**
 * Whether the block has any payload worth expanding.
 *
 * @param {object} parts - Possible content payloads.
 * @returns {boolean}
 */
export function hasExpandableContent({
  effectiveDetails,
  jsonData,
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
}) {
  return Boolean(
    effectiveDetails ||
      jsonData ||
      hasNested ||
      skillContent ||
      questions ||
      plan ||
      pendingQuestions ||
      todoData ||
      taskPrompt ||
      systemReminders ||
      persistedOutput ||
      toolInput,
  )
}

/**
 * Default-collapsed state for the block: dupe-of-summary or per-tool defaults.
 */
export function shouldStartCollapsed({
  toolName,
  singleLineDuplicate,
  jsonData,
  hasNested,
  isPending,
  wasAnswered,
}) {
  return (
    singleLineDuplicate ||
    shouldCollapseByDefault(toolName, jsonData, hasNested, isPending, wasAnswered)
  )
}

/**
 * Live duration in seconds for a still-pending block, only after >= 30s.
 */
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
