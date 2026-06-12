/** TUI-style tool use and result block with expandable content. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { normalizeToolName, ToolName } from '../../../../../../config/schema'
import useCapabilities from '../../../../../../hooks/useCapabilities'
import { processNestedEvents } from '../../../../../../utils/eventProcessing'
import { useTurn } from '../../hooks/useTurn'
import InteractiveQuestions from './components/interactive-questions'
import ToolBlockHeader from './components/ToolBlockHeader'
import ToolBlockExpandedContent from './components/tool-block-expanded-content/ToolBlockExpandedContent'
import useInteractiveState from './hooks/useInteractiveState'
import useToolResult from './hooks/useToolResult'
import { parseAnswerLabel } from './utils/answerLabel'
import { PLAN_REVIEW_QUESTIONS } from './utils/constants'
import {
  computeLiveBlockDuration,
  hasExpandableContent,
  isAskUserAwaitingAnswer,
  isPlanAwaitingAnswer,
  isSingleLineDuplicate,
  shouldStartCollapsed,
} from './utils/toolBlockState'
import {
  buildToolHeader,
  getToolStatus,
  getToolTooltip,
  hasSpecializedFormatter,
} from './utils/toolResultFormatters'

/**
 * Render a TUI-style tool use block with header, result summary, and expandable content.
 * Consumes TurnContext for turn-scoped data.
 * @param {Object} props
 * @param {Object} props.toolUse - Tool use data with content, tool_use_id, and tool_input.
 * @param {Object} [props.toolResult] - Tool result with content string.
 * @param {Array} [props.nestedEvents] - Nested events for Task tools.
 * @param {string} [props.skillContent] - Skill content to display.
 * @param {Object} [props.todoDiff] - Todo diff for TodoWrite tool.
 * @param {boolean} [props.nested=false] - Whether this block is nested inside another.
 * @param {number} [props.blockRelativeTime] - Precomputed offset from turn start in seconds.
 */
export default function ToolBlock({
  toolUse,
  toolResult,
  nestedEvents,
  skillContent,
  todoDiff = null,
  nested = false,
  blockRelativeTime = null,
}) {
  const { hasPendingMessages, onFormSubmit, now, isActiveTurn } = useTurn()
  const { capabilities } = useCapabilities()
  // Render unless the runtime explicitly opts out via supports_ask_user_question=false.
  // Absent or undefined treated as "supported" for back-compat with fixtures and
  // pre-init session-data races.
  const askUserQuestionEnabled = capabilities?.supports_ask_user_question !== false

  const [showDetails, setShowDetails] = useState(null) // null = use default

  // Normalise tool name so LangGraph's snake_case names (ask_user_question)
  // resolve to the same canonical Claude form (AskUserQuestion) every
  // downstream comparison reads. See schema.js::TOOL_NAME_ALIASES.
  const toolName = normalizeToolName(toolUse?.content || 'Tool')
  const input = toolUse?.tool_input ?? {}
  const toolUseId = toolUse?.tool_use_id ?? null
  const filePath = input?.file_path || null
  const outputMode = input?.output_mode || null
  const lineOffset = toolUse?.source_offset ?? null
  const tooltip = getToolTooltip(toolName, input)

  // Extract tool result state (consumes TurnContext for taskNotifications)
  const {
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
    taskNotification,
    isTaskOutputKilled,
    isAsyncTask,
    resultContent,
    isPending,
    jsonData,
  } = useToolResult(toolUse, toolResult, todoDiff)

  // Track interactive answer state (consumes TurnContext for message state)
  const {
    wasAnswered,
    isAwaitingAnswer,
    wasSkipped,
    answerLabel,
    wasAnsweredLocally,
    setWasAnsweredLocally,
    setLocalAnswerLabel,
  } = useInteractiveState(toolName, isPending, resultContent, plan)

  // For AskUserQuestion awaiting response, extract questions from input.
  // Guard against truthy non-array payloads (e.g. a JSON-encoded string emitted
  // by an upstream serialization bug) so the InteractiveQuestions consumer
  // never receives a non-iterable.
  const askUserAwaiting = isAskUserAwaitingAnswer(toolName, isPending, resultContent, wasAnswered)
  const pendingQuestions =
    askUserAwaiting && Array.isArray(input.questions) ? input.questions : null

  // ExitPlanMode awaits response when plan is present and not yet answered
  const planAwaiting = isPlanAwaitingAnswer(toolName, plan, wasAnswered)

  // Process nested events for Task
  const nestedBlocks = useMemo(() => processNestedEvents(nestedEvents), [nestedEvents])
  const hasNested = nestedBlocks.length > 0

  // tool_input for unhandled tools - null for handled tools (they render their own way)
  const toolInput =
    !hasSpecializedFormatter(toolName) && Object.keys(input).length > 0 ? input : null

  // Single-line result identical to summary - keep expandable but start collapsed
  const singleLineDuplicate = isSingleLineDuplicate(effectiveDetails, effectiveSummary)

  const hasExpandable = hasExpandableContent({
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
  })
  // Default: collapsed for JSON, Read, Skill, answered AskUserQuestion, completed Task with nested
  const collapseByDefault = shouldStartCollapsed({
    toolName,
    singleLineDuplicate,
    jsonData,
    hasNested,
    isPending,
    wasAnswered,
  })
  const effectiveShowDetails = showDetails !== null ? showDetails : !collapseByDefault

  // Format header: tool name with args - show full path when expanded for file tools
  const header = useMemo(
    () => buildToolHeader(toolName, input, effectiveShowDetails),
    [toolName, input, effectiveShowDetails],
  )

  // Auto-collapse when Task completes (isPending transitions false)
  const prevPendingRef = useRef(isPending)
  useEffect(() => {
    if (prevPendingRef.current && !isPending && (hasNested || isAsyncTask)) {
      // Was pending, now complete - collapse
      setShowDetails(false)
    }
    prevPendingRef.current = isPending
  }, [isPending, hasNested, isAsyncTask])

  // Auto-expand when pending Task gets nested events (nested tools streaming in)
  const prevHasNestedRef = useRef(hasNested)
  useEffect(() => {
    if (toolName === ToolName.TASK && isPending && !prevHasNestedRef.current && hasNested) {
      // Nested events just arrived while Task running - expand to show them
      setShowDetails(true)
    }
    prevHasNestedRef.current = hasNested
  }, [toolName, isPending, hasNested])

  const handleToggle = () => hasExpandable && setShowDetails(!effectiveShowDetails)

  // Block timing: live duration for pending blocks (>= 30s threshold)
  const toolUseTime = toolUse?.ts ? new Date(toolUse.ts).getTime() : null
  const toolResultTime = toolResult?.ts ? new Date(toolResult.ts).getTime() : null

  const blockDuration = useMemo(
    () =>
      computeLiveBlockDuration({
        isAsyncTask,
        toolUseTime,
        toolResultTime,
        isActiveTurn,
        now,
      }),
    [isAsyncTask, toolUseTime, toolResultTime, isActiveTurn, now],
  )

  return (
    <div
      className={`tool-block ${nested ? 'nested' : ''} ${effectiveIsError ? 'tool-error' : ''}`}
      data-testid="tool-block"
      data-tool-use-id={toolUseId}
      data-tool-status={getToolStatus(effectiveIsPending, isAwaitingAnswer, effectiveIsError)}>
      <ToolBlockHeader
        header={header}
        toolName={toolName}
        tooltip={tooltip}
        summary={effectiveSummary}
        hasExpandable={hasExpandable}
        onToggle={handleToggle}
        toolStatus={{
          isPending: effectiveIsPending,
          isAwaitingAnswer,
          wasAnswered,
          wasSkipped,
          isError: effectiveIsError,
          answerLabel,
          taskNotification,
          isTaskOutputKilled,
          blockDuration: effectiveIsPending ? blockDuration : null,
          blockRelativeTime: effectiveIsPending ? null : blockRelativeTime,
        }}
      />

      {/* Interactive questions for AskUserQuestion - hide during pending state after local submit (Q/A bubble shows instead);
          also gated on the runtime's supports_ask_user_question capability so non-supporting runtimes do not render the form. */}
      {toolName === ToolName.ASK_USER_QUESTION &&
        askUserQuestionEnabled &&
        input.questions?.length > 0 &&
        effectiveShowDetails &&
        !(wasAnsweredLocally && hasPendingMessages) && (
          <InteractiveQuestions
            questions={input.questions}
            disabled={wasAnswered || hasPendingMessages}
            onSubmit={answer => {
              setWasAnsweredLocally(true)
              setShowDetails(false) // Auto-collapse on submit
              onFormSubmit?.(answer)
            }}
          />
        )}

      {/* Expanded content - show for completed tools, pending Task (nested tools stream in), or unhandled tools with input */}
      {(!isPending || toolName === ToolName.TASK || toolInput) &&
        effectiveShowDetails &&
        !(toolName === ToolName.ASK_USER_QUESTION && wasAnswered) && (
          <ToolBlockExpandedContent
            toolName={toolName}
            filePath={filePath}
            outputMode={outputMode}
            contentData={{
              details: effectiveDetails,
              jsonData,
              skillContent,
              questions,
              pendingQuestions,
              plan,
              todoData,
              taskPrompt,
              systemReminders,
              persistedOutput,
            }}
            toolInput={toolInput}
            nestedBlocks={nestedBlocks}
            todoDiff={todoDiff}
            toolUseId={toolUseId}
            lineOffset={lineOffset}
          />
        )}

      {/* Plan approve/reject for ExitPlanMode - rendered after plan content */}
      {planAwaiting && effectiveShowDetails && !(wasAnsweredLocally && hasPendingMessages) && (
        <InteractiveQuestions
          questions={PLAN_REVIEW_QUESTIONS}
          responseTag="ExitPlanMode"
          disabled={wasAnswered || hasPendingMessages}
          onSubmit={answer => {
            const label = parseAnswerLabel(answer)
            if (label) {
              setLocalAnswerLabel(label)
            }
            setWasAnsweredLocally(true)
            setShowDetails(false)
            onFormSubmit?.(answer)
          }}
        />
      )}
    </div>
  )
}
